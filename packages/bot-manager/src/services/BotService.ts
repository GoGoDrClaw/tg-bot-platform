import { randomUUID } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import AdmZip from "adm-zip";
import fetch from "node-fetch";
import { Repository } from "typeorm";
import type { RuntimeAdapter } from "@bot-platform/runtime-adapters";
import { AppDataSource } from "@/datasource";
import { Bot, BotRuntime, BotStatus } from "@/entities/Bot";
import { BotEnv } from "@/entities/BotEnv";
import { BotRuntimeMeta } from "@/entities/BotRuntimeMeta";
import { BotAccess } from "@/entities/BotAccess";
import { User } from "@/entities/User";
import { BotLog, LogLevel } from "@/entities/BotLog";
import { DatabaseService } from "@/services/DatabaseService";
import { createRuntimeAdapter } from "@/runtime/adapterFactory";
import { loadBotManifest, validateBotProject, getAllowedEnvVariables } from "@/validators/botValidator";
import { runCommand } from "@/utils/exec";
import { BotManifest } from "@/types/botManifest";
import { createLogger } from "@/utils/logger";
import ts from "typescript";
import type { Response } from "node-fetch";

const CURRENT_RUNTIME_VERSION = process.env.RUNTIME_VERSION ?? "1.2.0";
const RUNTIME_PORT = Number(process.env.RUNTIME_PORT ?? "8080");
type GitStatus = {
  repo: string;
  stored: string;
  current: string;
  latest: string;
  updateAvailable: boolean;
};

export type SourceType = "git" | "zip" | "local";

export interface CreateBotInput {
  name: string;
  code?: string;
  runtime: BotRuntime;
  sourceType: SourceType;
  source: string;
  botToken: string;
  env?: Record<string, string>;
}

export class BotService {
  private botRepo: Repository<Bot>;
  private envRepo: Repository<BotEnv>;
  private metaRepo: Repository<BotRuntimeMeta>;
  private accessRepo: Repository<BotAccess>;
  private userRepo: Repository<User>;
  private logRepo: Repository<BotLog>;
  private dbService: DatabaseService;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private log = createLogger("BotService");

  constructor() {
    this.botRepo = AppDataSource.getRepository(Bot);
    this.envRepo = AppDataSource.getRepository(BotEnv);
    this.metaRepo = AppDataSource.getRepository(BotRuntimeMeta);
    this.accessRepo = AppDataSource.getRepository(BotAccess);
    this.userRepo = AppDataSource.getRepository(User);
    this.logRepo = AppDataSource.getRepository(BotLog);
    this.dbService = new DatabaseService();
  }

  async init() {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    if (!this.reconcileInterval) {
      const seconds = Number(process.env.STATUS_RECONCILE_SEC ?? "20");
      this.reconcileInterval = setInterval(() => {
        this.reconcileStatuses().catch((err) => console.error("reconcile error", err));
      }, seconds * 1000);
    }
  }

  async createBot(payload: CreateBotInput, userId?: string, onLog?: (chunk: string) => void): Promise<Bot> {
    await this.init();

    // Generate or validate bot code
    let botCode = payload.code || this.slugify(payload.name);
    if (!botCode) {
      botCode = `bot-${Date.now()}`;
    }

    // Check if code already exists
    const existingBot = await this.botRepo.findOne({ where: { code: botCode } });
    if (existingBot) {
      throw new Error(`Bot with code '${botCode}' already exists. Please choose a different code.`);
    }

    const botId = randomUUID();
    const workdir = resolve("storage/bots", botId);
    mkdirSync(workdir, { recursive: true });
    this.log.info(`creating bot ${botId} name=${payload.name} code=${botCode} runtime=${payload.runtime} source=${payload.source}`);

    await this.materializeSource(payload.sourceType, payload.source, workdir);
    const gitMeta = payload.sourceType === "git" ? await this.readGitMeta(workdir) : null;
    const validation = validateBotProject(workdir);
    if (!validation.ok || !validation.manifest || !validation.pkg) {
      throw new Error(`Bot validation failed: ${validation.reason}`);
    }

    const manifest = validation.manifest;
    const pkg = validation.pkg;

    const imageName = `bot-platform/${botId}:latest`;
    await this.buildImage(imageName, workdir, manifest, onLog);

    const webhookBase = this.getWebhookBase();
    const webhookUrl = `${webhookBase}/${botId}`;

    const bot = this.botRepo.create({
      id: botId,
      name: payload.name || pkg.name || `bot-${botId.slice(0, 6)}`,
      code: botCode,
      status: "created",
      runtime: payload.runtime,
      runtimeVersion: CURRENT_RUNTIME_VERSION,
      imageName,
      webhookUrl,
    });
    await this.botRepo.save(bot);

    // Filter env to only include allowed variables from manifest
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};
    const filteredEnv: Record<string, string> = {};
    if (payload.env) {
      for (const [key, value] of Object.entries(payload.env)) {
        if (key in allowedEnv) {
          filteredEnv[key] = value;
        } else if (key !== "BOT_TOKEN") {
          this.log.warn(`Ignoring env variable ${key} - not in manifest for bot ${botId}`);
        }
      }
    }

    await this.envRepo.save([
      this.envRepo.create({
        bot,
        key: "BOT_TOKEN",
        value: payload.botToken,
      }),
      ...Object.entries(filteredEnv).map(([key, value]) =>
        this.envRepo.create({
          bot,
          key,
          value,
        })
      ),
    ]);

    // Grant owner access to the creating user
    if (userId) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (user) {
        const access = this.accessRepo.create({
          user,
          bot,
          permission: "owner",
        });
        await this.accessRepo.save(access);
        this.log.info(`Bot owner access granted to user ${userId} for bot ${botId}`);
      }
    }

    await this.setMeta(bot, "source_type", payload.sourceType);
    if (payload.sourceType === "git" && gitMeta) {
      await this.setMeta(bot, "git_repo", gitMeta.repo);
      await this.setMeta(bot, "git_commit", gitMeta.commit);

      // Check if we're on a release tag
      const releaseInfo = await this.getLatestRelease(workdir).catch(() => null);
      if (releaseInfo && releaseInfo.commit === gitMeta.commit) {
        await this.setMeta(bot, "git_version", releaseInfo.tag);
        this.log.info(`Bot ${botId} created from release ${releaseInfo.tag}`);
      }
    } else if (payload.sourceType === "local" || payload.sourceType === "zip") {
      await this.setMeta(bot, "source_path", payload.source);
    }

    // Create isolated database for bot
    try {
      const dbCreds = await this.dbService.createBotDatabase(botId);
      await this.envRepo.save(
        this.envRepo.create({
          bot,
          key: "DATABASE_URL",
          value: dbCreds.url,
        })
      );
      this.log.info(`Database created for bot ${botId}: ${dbCreds.type}`);
    } catch (err) {
      this.log.error(`Failed to create database for bot ${botId}:`, err);
      // Non-fatal: bot can work without database
    }

    return bot;
  }

  async startBot(botId: string): Promise<Bot> {
    await this.init();
    const bot = await this.botRepo.findOne({
      where: { id: botId },
      relations: ["envs", "runtimeMeta"],
    });
    if (!bot) {
      throw new Error("Bot not found");
    }
    this.ensureRuntimeVersion(bot);

    const runtime = createRuntimeAdapter(bot.runtime);
    const port = await this.ensurePort(bot, runtime);
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) {
      throw new Error("Missing BOT_TOKEN env");
    }

    // Get admin IDs for the bot
    const { ownerId, adminIds } = await this.getBotAdminIds(bot.id);

    // Get env config mapping from manifest
    const manifest = this.getBotManifest(bot.id);
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};
    const envConfigMap: Record<string, string> = {};
    for (const [envKey, config] of Object.entries(allowedEnv)) {
      if (config.configKey) {
        envConfigMap[envKey] = config.configKey;
      }
    }

    const env = {
      BOT_TOKEN: token,
      BOT_ID: bot.id,
      PORT: port.toString(),
      WEBHOOK_URL: bot.webhookUrl,
      TELEGRAM_API_BASE: this.getTelegramApiBase(),
      BOT_MANAGER_URL: process.env.BOT_MANAGER_URL || "http://bot-manager:3000",
      ...(Object.keys(envConfigMap).length > 0 && { BOT_ENV_CONFIG: JSON.stringify(envConfigMap) }),
      ...(ownerId && { BOT_OWNER_ID: ownerId }),
      ...(adminIds.length > 0 && { BOT_ADMIN_IDS: adminIds.join(",") }),
      ...this.envMap(bot),
    };

    await runtime.deployBot({
      botId: bot.id,
      imageName: bot.imageName,
      port,
      env,
      webhookUrl: bot.webhookUrl,
      resources: { cpu: "0.5", memory: "256m" },
    });

    // Logout from Telegram official server and register webhook on local Bot API
    try {
      await this.logOut(token);
      this.log.info(`bot ${bot.id} logged out from Telegram official server`);
    } catch (e) {
      this.log.warn(`logOut failed for ${bot.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.setWebhook(token, bot.webhookUrl);
    this.log.info(`bot ${bot.id} webhook registered: ${bot.webhookUrl}`);

    bot.status = "running";
    await this.botRepo.save(bot);
    this.log.info(`bot ${bot.id} started on port ${port} runtime=${bot.runtime}`);
    return bot;
  }

  async stopBot(botId: string): Promise<void> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs"] });
    if (!bot) {
      throw new Error("Bot not found");
    }
    const runtime = createRuntimeAdapter(bot.runtime);
    await runtime.stopBot(botId);
    this.log.info(`bot ${botId} stopped (runtime ${bot.runtime})`);

    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (token) {
      await this.deleteWebhook(token);
    }

    bot.status = "stopped";
    await this.botRepo.save(bot);
  }

  async restartBot(botId: string): Promise<void> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId } });
    if (!bot) {
      throw new Error("Bot not found");
    }
    const runtime = createRuntimeAdapter(bot.runtime);
    await runtime.restartBot(botId);
    this.log.info(`bot ${botId} restart issued`);
  }

  async upgradeRuntime(botId: string, onLog?: (chunk: string) => void): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (!bot) {
      throw new Error("Bot not found");
    }
    const workdir = resolve("storage/bots", botId);
    if (!existsSync(workdir)) {
      throw new Error("Bot workspace not found for rebuild");
    }
    const validation = validateBotProject(workdir);
    if (!validation.ok || !validation.manifest) {
      throw new Error(`Bot validation failed: ${validation.reason ?? "unknown"}`);
    }

    await this.buildImage(bot.imageName, workdir, validation.manifest, onLog);

    const runtime = createRuntimeAdapter(bot.runtime);
    const port = await this.ensurePort(bot, runtime);
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) {
      throw new Error("Missing BOT_TOKEN env");
    }

    // Get admin IDs for the bot
    const { ownerId, adminIds } = await this.getBotAdminIds(bot.id);

    // Get env config mapping from manifest
    const manifest = this.getBotManifest(bot.id);
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};
    const envConfigMap: Record<string, string> = {};
    for (const [envKey, config] of Object.entries(allowedEnv)) {
      if (config.configKey) {
        envConfigMap[envKey] = config.configKey;
      }
    }

    const env = {
      BOT_TOKEN: token,
      BOT_ID: bot.id,
      PORT: port.toString(),
      WEBHOOK_URL: bot.webhookUrl,
      TELEGRAM_API_BASE: this.getTelegramApiBase(),
      BOT_MANAGER_URL: process.env.BOT_MANAGER_URL || "http://bot-manager:3000",
      ...(Object.keys(envConfigMap).length > 0 && { BOT_ENV_CONFIG: JSON.stringify(envConfigMap) }),
      ...(ownerId && { BOT_OWNER_ID: ownerId }),
      ...(adminIds.length > 0 && { BOT_ADMIN_IDS: adminIds.join(",") }),
      ...this.envMap(bot),
    };

    await runtime.deployBot({
      botId: bot.id,
      imageName: bot.imageName,
      port,
      env,
      webhookUrl: bot.webhookUrl,
      resources: { cpu: "0.5", memory: "256m" },
    });

    // Logout from Telegram official server and register webhook on local Bot API
    try {
      await this.logOut(token);
      this.log.info(`bot ${bot.id} logged out from Telegram official server`);
    } catch (e) {
      this.log.warn(`logOut failed for ${bot.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.setWebhook(token, bot.webhookUrl);
    this.log.info(`bot ${bot.id} webhook registered: ${bot.webhookUrl}`);

    bot.status = "running";
    bot.runtimeVersion = CURRENT_RUNTIME_VERSION;
    await this.botRepo.save(bot);
    this.log.info(`bot ${bot.id} upgraded to runtime ${CURRENT_RUNTIME_VERSION}`);
    return this.serializeBot(bot);
  }

  async setupWebhook(botId: string): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs"] });
    if (!bot) throw new Error("Bot not found");
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) throw new Error("Missing BOT_TOKEN env");
    const desiredWebhook = `${this.getWebhookBase()}/${bot.id}`;
    if (bot.webhookUrl !== desiredWebhook) {
      bot.webhookUrl = desiredWebhook;
      await this.botRepo.save(bot);
      this.log.info(`webhook URL updated for ${bot.id} -> ${desiredWebhook}`);
    }
    try {
      await this.logOut(token);
    } catch (e) {
      this.log.error(e as string);
    }
    await this.setWebhook(token, bot.webhookUrl);
    const info = await this.getWebhookInfo(token);
    return { ...this.serializeBot(bot), webhookInfo: info };
  }

  async getWebhook(botId: string): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs"] });
    if (!bot) throw new Error("Bot not found");
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) throw new Error("Missing BOT_TOKEN env");
    const info = await this.getWebhookInfo(token);
    return info;
  }

  async deleteWebhooks(botId: string): Promise<void> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs"] });
    if (!bot) throw new Error("Bot not found");
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) throw new Error("Missing BOT_TOKEN env");
    await this.deleteWebhook(token);
  }

  async updateBot(botId: string, payload?: { source?: string }, onLog?: (chunk: string) => void): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");

    const sourceType = this.getMeta(bot, "source_type") as SourceType | undefined;
    if (!sourceType) {
      throw new Error("Bot source type not found");
    }

    this.log.info(`Updating bot ${botId} (source type: ${sourceType})`);

    switch (sourceType) {
      case "git":
        return this.gitUpgrade(botId, onLog);

      case "zip":
        if (!payload?.source) {
          throw new Error("New ZIP source path is required for ZIP bot updates");
        }
        return this.zipUpdate(botId, payload.source, onLog);

      case "local":
        return this.localUpdate(botId, onLog);

      default:
        throw new Error(`Unknown source type: ${sourceType}`);
    }
  }

  async zipUpdate(botId: string, newZipSource: string, onLog?: (chunk: string) => void): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");

    const workdir = resolve("storage/bots", botId);
    if (!existsSync(workdir)) {
      throw new Error("Bot workspace not found");
    }

    this.log.info(`Updating bot ${botId} from new ZIP: ${newZipSource}`);
    if (onLog) onLog(`📦 Updating from new ZIP: ${newZipSource}\n`);

    // Backup current directory
    const backupDir = `${workdir}.backup`;
    if (existsSync(backupDir)) {
      await runCommand("rm", ["-rf", backupDir]);
    }
    await runCommand("mv", [workdir, backupDir]);

    try {
      // Extract new ZIP
      mkdirSync(workdir, { recursive: true });
      const zipPath = this.resolveLocalPath(newZipSource);
      if (!zipPath) {
        throw new Error(`ZIP source not found: ${newZipSource}`);
      }
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(workdir, true);

      // Validate
      const validation = validateBotProject(workdir);
      if (!validation.ok || !validation.manifest) {
        throw new Error(`Bot validation failed: ${validation.reason ?? "unknown"}`);
      }

      // Build and deploy
      await this.buildImage(bot.imageName, workdir, validation.manifest, onLog);

      const runtime = createRuntimeAdapter(bot.runtime);
      const port = await this.ensurePort(bot, runtime);
      const token = this.getEnvValue(bot, "BOT_TOKEN");
      if (!token) {
        throw new Error("Missing BOT_TOKEN env");
      }

      const { ownerId, adminIds } = await this.getBotAdminIds(bot.id);

      const env = {
        BOT_TOKEN: token,
        BOT_ID: bot.id,
        PORT: port.toString(),
        WEBHOOK_URL: bot.webhookUrl,
        TELEGRAM_API_BASE: this.getTelegramApiBase(),
        ...(ownerId && { BOT_OWNER_ID: ownerId }),
        ...(adminIds.length > 0 && { BOT_ADMIN_IDS: adminIds.join(",") }),
        ...this.envMap(bot),
      };

      await runtime.deployBot({
        botId: bot.id,
        imageName: bot.imageName,
        port,
        env,
        webhookUrl: bot.webhookUrl,
        resources: { cpu: "0.5", memory: "256m" },
      });

      try {
        await this.logOut(token);
        this.log.info(`bot ${bot.id} logged out from Telegram official server`);
      } catch (e) {
        this.log.warn(`logOut failed for ${bot.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await this.setWebhook(token, bot.webhookUrl);

      bot.status = "running";
      bot.runtimeVersion = CURRENT_RUNTIME_VERSION;
      await this.botRepo.save(bot);
      await this.setMeta(bot, "source_path", newZipSource);

      // Remove backup
      await runCommand("rm", ["-rf", backupDir]);

      this.log.info(`bot ${bot.id} updated from ZIP successfully`);
      return this.serializeBot(bot);
    } catch (err) {
      // Restore backup on error
      this.log.error(`ZIP update failed for ${botId}, restoring backup`);
      if (existsSync(workdir)) {
        await runCommand("rm", ["-rf", workdir]);
      }
      await runCommand("mv", [backupDir, workdir]);
      throw err;
    }
  }

  async localUpdate(botId: string, onLog?: (chunk: string) => void): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");

    const sourcePath = this.getMeta(bot, "source_path");
    if (!sourcePath) {
      throw new Error("Local source path not found in bot metadata");
    }

    const workdir = resolve("storage/bots", botId);
    if (!existsSync(workdir)) {
      throw new Error("Bot workspace not found");
    }

    this.log.info(`Updating bot ${botId} from local path: ${sourcePath}`);
    if (onLog) onLog(`📂 Updating from local path: ${sourcePath}\n`);

    // Remove current content
    await runCommand("rm", ["-rf", workdir]);
    mkdirSync(workdir, { recursive: true });

    // Copy from source
    const resolved = this.resolveLocalPath(sourcePath);
    if (!resolved) {
      throw new Error(`Local source not found: ${sourcePath}`);
    }
    cpSync(resolved, workdir, { recursive: true });

    // Validate
    const validation = validateBotProject(workdir);
    if (!validation.ok || !validation.manifest) {
      throw new Error(`Bot validation failed: ${validation.reason ?? "unknown"}`);
    }

    // Build and deploy
    await this.buildImage(bot.imageName, workdir, validation.manifest, onLog);

    const runtime = createRuntimeAdapter(bot.runtime);
    const port = await this.ensurePort(bot, runtime);
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) {
      throw new Error("Missing BOT_TOKEN env");
    }

    const { ownerId, adminIds } = await this.getBotAdminIds(bot.id);

    const env = {
      BOT_TOKEN: token,
      BOT_ID: bot.id,
      PORT: port.toString(),
      WEBHOOK_URL: bot.webhookUrl,
      TELEGRAM_API_BASE: this.getTelegramApiBase(),
      BOT_MANAGER_URL: process.env.BOT_MANAGER_URL || "http://bot-manager:3000",
      ...(ownerId && { BOT_OWNER_ID: ownerId }),
      ...(adminIds.length > 0 && { BOT_ADMIN_IDS: adminIds.join(",") }),
      ...this.envMap(bot),
    };

    await runtime.deployBot({
      botId: bot.id,
      imageName: bot.imageName,
      port,
      env,
      webhookUrl: bot.webhookUrl,
      resources: { cpu: "0.5", memory: "256m" },
    });

    try {
      await this.logOut(token);
      this.log.info(`bot ${bot.id} logged out from Telegram official server`);
    } catch (e) {
      this.log.warn(`logOut failed for ${bot.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.setWebhook(token, bot.webhookUrl);

    bot.status = "running";
    bot.runtimeVersion = CURRENT_RUNTIME_VERSION;
    await this.botRepo.save(bot);

    this.log.info(`bot ${bot.id} updated from local path successfully`);
    return this.serializeBot(bot);
  }

  async removeBot(botId: string): Promise<void> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId } });
    if (!bot) return;
    await this.stopBot(botId);

    // Delete bot's isolated database
    try {
      await this.dbService.deleteBotDatabase(botId);
      this.log.info(`Database deleted for bot ${botId}`);
    } catch (err) {
      this.log.error(`Failed to delete database for bot ${botId}:`, err);
    }

    await this.botRepo.remove(bot);
  }

  async getBots(): Promise<any[]> {
    await this.init();
    const bots = await this.botRepo.find({ relations: ["envs", "runtimeMeta"] });
    await this.refreshStatuses(bots);
    const refreshed = await this.botRepo.find({ relations: ["envs", "runtimeMeta"] });
    const enriched = await Promise.all(refreshed.map((b) => this.attachGitStatus(b)));
    return enriched.map((b) => this.serializeBot(b));
  }

  async getBot(botId: string): Promise<any | null> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (bot) {
      await this.refreshStatuses([bot]);
      const fresh = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
      if (!fresh) return null;
      const enriched = await this.attachGitStatus(fresh);
      return this.serializeBot(enriched);
    }
    return bot;
  }

  async getUserBots(userId: string, userRole: string): Promise<any[]> {
    await this.init();

    let bots: Bot[];

    if (userRole === "admin") {
      // Admins see all bots
      bots = await this.botRepo.find({ relations: ["envs", "runtimeMeta"] });
    } else {
      // Regular users see only bots they have access to
      const accessList = await this.accessRepo.find({
        where: { user: { id: userId } },
        relations: ["bot", "bot.envs", "bot.runtimeMeta"],
      });
      bots = accessList.map((access) => access.bot);
    }

    await this.refreshStatuses(bots);
    const enriched = await Promise.all(bots.map((b) => this.attachGitStatus(b)));
    return enriched.map((b) => this.serializeBot(b));
  }

  async getLogs(botId: string, tail = 100): Promise<string> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId } });
    if (!bot) {
      throw new Error("Bot not found");
    }
    const runtime = createRuntimeAdapter(bot.runtime);
    return runtime.getLogs(botId, tail);
  }

  async saveLogs(
    botId: string,
    logs: Array<{ level: LogLevel; message: string; timestamp: string; metadata?: any }>
  ): Promise<void> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId } });
    if (!bot) {
      throw new Error("Bot not found");
    }

    const logEntries = logs.map((log) =>
      this.logRepo.create({
        bot,
        botId,
        level: log.level,
        message: log.message,
        timestamp: new Date(log.timestamp),
        metadata: log.metadata,
      })
    );

    await this.logRepo.save(logEntries);
    this.log.debug(`Saved ${logs.length} logs for bot ${botId}`);
  }

  async forwardWebhook(botId: string, update: any): Promise<void> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");
    const port = await this.ensurePort(bot, createRuntimeAdapter(bot.runtime));
    const url = `http://bot-${botId}:${port}/webhook`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update ?? {}),
    }).catch((err: any) => {
      this.log.error(`forward webhook failed ${botId}`, err?.message || err);
      throw err;
    });
    if (!res.ok) {
      const body = await res.text();
      this.log.warn(`webhook forward non-200 ${res.status} ${url} ${body}`);
    }
  }

  async updateEnv(botId: string, env: Record<string, string>): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");
    if (!env || typeof env !== "object") throw new Error("env must be an object");

    // Filter env to only include allowed variables from manifest
    const manifest = this.getBotManifest(botId);
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};
    const filteredEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (key in allowedEnv) {
        filteredEnv[key] = value;
      } else if (key !== "BOT_TOKEN") {
        this.log.warn(`Ignoring env variable ${key} - not in manifest for bot ${botId}`);
      }
    }

    const existing = bot.envs ?? [];
    const next: BotEnv[] = [];

    // Update allowed env variables
    for (const key of Object.keys(filteredEnv)) {
      const current = existing.find((e) => e.key === key);
      if (current) {
        current.value = filteredEnv[key];
        next.push(current);
      } else {
        next.push(this.envRepo.create({ bot, key, value: filteredEnv[key] }));
      }
    }

    // Preserve BOT_TOKEN and other system env
    const preserved = existing.filter((e) => !filteredEnv[e.key] && (e.key === "BOT_TOKEN" || e.key === "DATABASE_URL"));
    const finalEnvs = [...preserved, ...next];
    await this.envRepo.remove(existing.filter((e) => !finalEnvs.includes(e)));
    await this.envRepo.save(finalEnvs);
    bot.envs = finalEnvs;
    return this.serializeBot(bot);
  }

  async checkUpdateStatus(botId: string): Promise<any> {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");

    const sourceType = this.getMeta(bot, "source_type") as SourceType | undefined;
    if (!sourceType) {
      throw new Error("Bot source type not found");
    }

    switch (sourceType) {
      case "git":
        return this.gitStatus(botId);

      case "zip":
        return {
          sourceType: "zip",
          canUpdate: true,
          message: "ZIP bots can be updated by providing a new ZIP file path",
          sourcePath: this.getMeta(bot, "source_path"),
        };

      case "local":
        return {
          sourceType: "local",
          canUpdate: true,
          message: "Local bots can be updated by rebuilding from the source path",
          sourcePath: this.getMeta(bot, "source_path"),
        };

      default:
        throw new Error(`Unknown source type: ${sourceType}`);
    }
  }

  async gitStatus(botId: string) {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");
    const repo = this.getMeta(bot, "git_repo");
    const stored = this.getMeta(bot, "git_commit");
    if (!repo || !stored) {
      throw new Error("Bot is not linked to a git source");
    }
    const workdir = resolve("storage/bots", botId);
    const current = await runCommand("git", ["rev-parse", "HEAD"], workdir);

    // Fetch tags and branches
    await runCommand("git", ["fetch", "--tags", "--prune"], workdir);

    // Get latest release tag
    const releaseInfo = await this.getLatestRelease(workdir);

    let latest: string;
    let updateType: "release" | "branch";
    let latestVersion: string | undefined;
    let currentVersion: string | undefined;

    // Check if current commit is a release
    const currentReleaseInfo = await this.getReleaseByCommit(workdir, current.trim());
    if (currentReleaseInfo) {
      currentVersion = currentReleaseInfo.tag;
    }

    if (releaseInfo) {
      latest = releaseInfo.commit;
      updateType = "release";
      latestVersion = releaseInfo.tag;
    } else {
      // No releases, fallback to main branch
      await runCommand("git", ["fetch", "origin", "main", "--depth=1"], workdir).catch(() =>
        runCommand("git", ["fetch", "origin", "master", "--depth=1"], workdir)
      );
      latest = await runCommand("git", ["rev-parse", "FETCH_HEAD"], workdir);
      updateType = "branch";
    }

    return {
      sourceType: "git",
      repo,
      stored,
      current: current.trim(),
      latest: latest.trim(),
      updateAvailable: latest.trim() !== current.trim(),
      updateType,
      currentVersion,
      latestVersion,
      warning: updateType === "branch" ? "No releases found. Updates will use main/master branch (may be unstable)" : undefined,
    };
  }

  async gitUpgrade(botId: string, onLog?: (chunk: string) => void) {
    await this.init();
    const bot = await this.botRepo.findOne({ where: { id: botId }, relations: ["envs", "runtimeMeta"] });
    if (!bot) throw new Error("Bot not found");
    const repo = this.getMeta(bot, "git_repo");
    const stored = this.getMeta(bot, "git_commit");
    if (!repo || !stored) {
      throw new Error("Bot is not linked to a git source");
    }
    const workdir = resolve("storage/bots", botId);
    if (!existsSync(workdir)) {
      throw new Error("Bot workspace not found for git upgrade");
    }

    // Fetch tags and branches
    await runCommand("git", ["fetch", "--tags", "--prune"], workdir);

    // Get latest release or fallback to main
    const releaseInfo = await this.getLatestRelease(workdir);

    let targetRef: string;
    let updateType: "release" | "branch";
    let version: string | undefined;

    if (releaseInfo) {
      targetRef = releaseInfo.tag;
      updateType = "release";
      version = releaseInfo.tag;
      this.log.info(`Upgrading bot ${botId} to release ${releaseInfo.tag}`);
      if (onLog) onLog(`📦 Upgrading to release: ${releaseInfo.tag}\n`);
    } else {
      // No releases found, use main/master with warning
      this.log.warn(`No releases found for bot ${botId}, falling back to main/master branch`);
      if (onLog) onLog(`⚠️  WARNING: No releases found. Using main/master branch (may be unstable)\n`);

      try {
        await runCommand("git", ["fetch", "origin", "main", "--depth=1"], workdir);
        targetRef = "origin/main";
      } catch {
        await runCommand("git", ["fetch", "origin", "master", "--depth=1"], workdir);
        targetRef = "origin/master";
      }
      updateType = "branch";
    }

    // Checkout the target ref
    await runCommand("git", ["checkout", targetRef], workdir);
    await runCommand("git", ["reset", "--hard", targetRef], workdir);
    const latest = await runCommand("git", ["rev-parse", "HEAD"], workdir);

    const validation = validateBotProject(workdir);
    if (!validation.ok || !validation.manifest) {
      throw new Error(`Bot validation failed: ${validation.reason ?? "unknown"}`);
    }
    await this.buildImage(bot.imageName, workdir, validation.manifest, onLog);

    const runtime = createRuntimeAdapter(bot.runtime);
    const port = await this.ensurePort(bot, runtime);
    const token = this.getEnvValue(bot, "BOT_TOKEN");
    if (!token) {
      throw new Error("Missing BOT_TOKEN env");
    }

    // Get admin IDs for the bot
    const { ownerId, adminIds } = await this.getBotAdminIds(bot.id);

    // Get env config mapping from manifest
    const manifest = this.getBotManifest(bot.id);
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};
    const envConfigMap: Record<string, string> = {};
    for (const [envKey, config] of Object.entries(allowedEnv)) {
      if (config.configKey) {
        envConfigMap[envKey] = config.configKey;
      }
    }

    const env = {
      BOT_TOKEN: token,
      BOT_ID: bot.id,
      PORT: port.toString(),
      WEBHOOK_URL: bot.webhookUrl,
      TELEGRAM_API_BASE: this.getTelegramApiBase(),
      BOT_MANAGER_URL: process.env.BOT_MANAGER_URL || "http://bot-manager:3000",
      ...(Object.keys(envConfigMap).length > 0 && { BOT_ENV_CONFIG: JSON.stringify(envConfigMap) }),
      ...(ownerId && { BOT_OWNER_ID: ownerId }),
      ...(adminIds.length > 0 && { BOT_ADMIN_IDS: adminIds.join(",") }),
      ...this.envMap(bot),
    };

    await runtime.deployBot({
      botId: bot.id,
      imageName: bot.imageName,
      port,
      env,
      webhookUrl: bot.webhookUrl,
      resources: { cpu: "0.5", memory: "256m" },
    });

    // Logout from Telegram official server and register webhook on local Bot API
    try {
      await this.logOut(token);
      this.log.info(`bot ${bot.id} logged out from Telegram official server`);
    } catch (e) {
      this.log.warn(`logOut failed for ${bot.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await this.setWebhook(token, bot.webhookUrl);
    this.log.info(`bot ${bot.id} webhook registered: ${bot.webhookUrl}`);

    bot.status = "running";
    bot.runtimeVersion = CURRENT_RUNTIME_VERSION;
    await this.botRepo.save(bot);
    await this.setMeta(bot, "git_commit", latest.trim());
    if (version) {
      await this.setMeta(bot, "git_version", version);
    }
    return this.serializeBot(bot);
  }

  private async materializeSource(type: SourceType, source: string, target: string) {
    if (type === "git") {
      // Clone with tags
      await runCommand("git", ["clone", "--depth=1", source, target]);
      await runCommand("git", ["fetch", "--tags"], target);

      // Try to checkout latest release
      const releaseInfo = await this.getLatestRelease(target).catch(() => null);
      if (releaseInfo) {
        this.log.info(`Checking out release ${releaseInfo.tag}`);
        await runCommand("git", ["checkout", releaseInfo.tag], target);
      } else {
        this.log.warn(`No releases found for ${source}, using main/master branch`);
      }

      this.log.debug(`cloned git ${source} -> ${target}`);
    } else if (type === "zip") {
      const zipPath = this.resolveLocalPath(source);
      if (!zipPath) {
        throw new Error(`zip source not found: ${source}`);
      }
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(target, true);
      this.log.debug(`unzipped ${source} -> ${target}`);
    } else if (type === "local") {
      const resolved = this.resolveLocalPath(source);
      if (!resolved) {
        throw new Error(`local source not found: ${source}`);
      }
      cpSync(resolved, target, { recursive: true });
      this.log.debug(`copied local ${resolved} -> ${target}`);
    } else {
      throw new Error(`Unknown source type: ${type}`);
    }
  }

  private async readGitMeta(workdir: string): Promise<{ repo: string; commit: string }> {
    const repo = await runCommand("git", ["config", "--get", "remote.origin.url"], workdir);
    const commit = await runCommand("git", ["rev-parse", "HEAD"], workdir);
    return { repo: repo.trim(), commit: commit.trim() };
  }

  private async getLatestRelease(workdir: string): Promise<{ tag: string; commit: string } | null> {
    try {
      // Get all tags sorted by version (semver-like)
      const tagsOutput = await runCommand("git", ["tag", "-l", "--sort=-v:refname"], workdir);
      const tags = tagsOutput
        .trim()
        .split("\n")
        .filter((t) => t.trim());

      if (tags.length === 0) {
        return null;
      }

      // Get the latest tag
      const latestTag = tags[0];
      const commit = await runCommand("git", ["rev-list", "-n", "1", latestTag], workdir);

      return {
        tag: latestTag.trim(),
        commit: commit.trim(),
      };
    } catch (err) {
      this.log.debug(`Failed to get latest release: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async getReleaseByCommit(workdir: string, commit: string): Promise<{ tag: string; commit: string } | null> {
    try {
      // Get tags pointing to this commit
      const tagsOutput = await runCommand("git", ["tag", "--points-at", commit], workdir);
      const tags = tagsOutput
        .trim()
        .split("\n")
        .filter((t) => t.trim());

      if (tags.length === 0) {
        return null;
      }

      // Return the first tag (sorted by version)
      return {
        tag: tags[0].trim(),
        commit: commit.trim(),
      };
    } catch (err) {
      this.log.debug(`Failed to get release by commit: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private resolveLocalPath(input: string): string | null {
    if (isAbsolute(input) && existsSync(input)) return input;
    const cleaned = input.replace(/^\.\//, "");
    const basenameTarget = resolve(process.cwd(), "packages", input.split("/").pop() ?? input);
    const candidates = [
      resolve(process.cwd(), input),
      resolve(process.cwd(), cleaned),
      resolve(process.cwd(), "..", input),
      resolve(process.cwd(), "../..", input),
      resolve(process.cwd(), "packages", input),
      basenameTarget,
      resolve(__dirname, "..", "..", "..", "packages", input),
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
  }

  private slugify(text: string): string {
    const translitMap: Record<string, string> = {
      'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
      'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
      'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
      'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
      'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    };

    if (!text) return '';

    // Transliterate and convert to lowercase
    let slug = text
      .toLowerCase()
      .split('')
      .map(char => translitMap[char] || char)
      .join('');

    // Replace spaces and special chars with hyphens
    slug = slug
      .trim()
      .replace(/[^\w\s-]/g, '')  // Remove special characters
      .replace(/[\s_]+/g, '-')   // Replace spaces and underscores with hyphens
      .replace(/-+/g, '-')       // Replace multiple hyphens with single hyphen
      .replace(/^-+|-+$/g, '');  // Remove leading/trailing hyphens

    return slug;
  }

  private async buildImage(
    imageName: string,
    context: string,
    manifest: BotManifest,
    onLog?: (chunk: string) => void
  ) {
    const dockerfilePath = join(context, "Dockerfile.platform.generated");
    const osPackages = (manifest["os-packages"] ?? []).join(" ");
    const tsconfigBasePath = join(context, "tsconfig.base.json");
    if (!existsSync(tsconfigBasePath)) {
      writeFileSync(
        tsconfigBasePath,
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2020",
              module: "CommonJS",
              moduleResolution: "Node",
              esModuleInterop: true,
              strict: true,
              skipLibCheck: true,
              sourceMap: true,
              outDir: "dist",
              resolveJsonModule: true,
              types: ["node"],
              forceConsistentCasingInFileNames: true,
              experimentalDecorators: true,
              emitDecoratorMetadata: true,
              useDefineForClassFields: false,
            },
          },
          null,
          2
        ),
        "utf-8"
      );
    }

    const templateCandidates = [
      resolve(process.cwd(), "packages/bot-manager/templates"),
      resolve(__dirname, "../templates"),
      resolve(__dirname, "../../templates"),
    ];
    const templatesDir = templateCandidates.find((p) => existsSync(join(p, "runtime-server.ts"))) ?? templateCandidates[0];

    const runtimeTemplate = readFileSync(join(templatesDir, "runtime-server.ts"), "utf-8");
    const dockerfileTemplate = readFileSync(join(templatesDir, "Dockerfile.template"), "utf-8");

    const runtimeTsPath = join(context, "runtime-server.ts");
    const runtimeJsPath = join(context, "runtime-server.js");
    writeFileSync(runtimeTsPath, runtimeTemplate, "utf-8");
    const transpiled = ts.transpileModule(runtimeTemplate, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    writeFileSync(runtimeJsPath, transpiled.outputText, "utf-8");

    const dockerfileContent = dockerfileTemplate.replace(/__OS_PACKAGES__/g, osPackages);
    writeFileSync(dockerfilePath, dockerfileContent, "utf-8");
    this.log.info(`building image ${imageName}`);
    await runCommand(
      "docker",
      ["build", "-t", imageName, "-f", dockerfilePath, "--build-arg", `OS_PACKAGES=${osPackages}`, "."],
      context,
      { onStdout: onLog, onStderr: onLog }
    );
    this.log.info(`image built ${imageName}`);
  }

  private getEnvValue(bot: Bot, key: string): string | undefined {
    return bot.envs?.find((env) => env.key === key)?.value;
  }

  private async ensurePort(bot: Bot, runtime: RuntimeAdapter): Promise<number> {
    const existingPort = bot.runtimeMeta?.find((m) => m.key === "port");
    if (!existingPort || Number(existingPort.value) !== RUNTIME_PORT) {
      if (existingPort) {
        existingPort.value = String(RUNTIME_PORT);
        await this.metaRepo.save(existingPort);
      } else {
        const meta = this.metaRepo.create({ bot, key: "port", value: String(RUNTIME_PORT) });
        await this.metaRepo.save(meta);
      }
    }
    return RUNTIME_PORT;
  }

  private async setWebhook(botToken: string, webhookUrl: string) {
    const base = this.getTelegramApiBase();
    const res = await fetch(`${base}/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    if (!res.ok) {
      const data = await safeJson(res);
      const desc = data?.description;
      throw new Error(`setWebhook failed: ${desc || res.status}`);
    }
  }

  private async logOut(botToken: string) {
    // logOut should always hit the official API to clear sessions on Telegram side
    const base = "https://api.telegram.org";
    const res = await fetch(`${base}/bot${botToken}/logOut`, { method: "POST" });
    if (!res.ok) {
      const data = await safeJson(res);
      const desc = data?.description;
      throw new Error(`logOut failed: ${desc || res.status}`);
    }
  }

  private async getWebhookInfo(botToken: string) {
    const base = this.getTelegramApiBase();
    const res = await fetch(`${base}/bot${botToken}/getWebhookInfo`, { method: "POST" });
    if (!res.ok) {
      const data = await safeJson(res);
      const desc = data?.description;
      throw new Error(`getWebhookInfo failed: ${desc || res.status}`);
    }
    return res.json();
  }

  private async deleteWebhook(botToken: string) {
    const base = this.getTelegramApiBase();
    const res = await fetch(`${base}/bot${botToken}/deleteWebhook`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await safeJson(res);
      const desc = data?.description;
      throw new Error(`deleteWebhook failed: ${desc || res.status}`);
    }
  }

  private getWebhookBase(): string {
    const envBase = process.env.WEBHOOK_BASE_URL?.replace(/\/$/, "");
    if (envBase) return envBase;
    // Default to service name inside compose/stack so bot-api container can reach it
    return "http://bot-manager:3000/w";
  }

  private getTelegramApiBase(): string {
    return (process.env.TELEGRAM_API_BASE || "http://bot-api:8081").replace(/\/$/, "");
  }

  private async setMeta(bot: Bot, key: string, value: string) {
    const existing =
      bot.runtimeMeta?.find((m) => m.key === key) ||
      (await this.metaRepo.findOne({ where: { bot: { id: bot.id }, key } as any }));
    if (existing) {
      existing.value = value;
      await this.metaRepo.save(existing);
    } else {
      const meta = this.metaRepo.create({ bot, key, value });
      await this.metaRepo.save(meta);
      bot.runtimeMeta = [...(bot.runtimeMeta ?? []), meta];
    }
  }

  private getMeta(bot: Bot, key: string): string | undefined {
    return bot.runtimeMeta?.find((m) => m.key === key)?.value;
  }

  private async attachGitStatus(bot: Bot): Promise<Bot & { gitStatus?: GitStatus }> {
    try {
      await this.ensureGitMeta(bot);
      const status = await this.computeGitStatus(bot);
      return Object.assign(bot, { gitStatus: status ?? undefined });
    } catch (err) {
      this.log.warn(`git status failed for ${bot.id}: ${err instanceof Error ? err.message : String(err)}`);
      return bot;
    }
  }

  private async ensureGitMeta(bot: Bot) {
    const hasMeta = this.getMeta(bot, "git_repo") && this.getMeta(bot, "git_commit");
    if (hasMeta) return;
    const workdir = resolve("storage/bots", bot.id);
    if (!existsSync(join(workdir, ".git"))) return;
    const meta = await this.readGitMeta(workdir).catch(() => null);
    if (meta) {
      await this.setMeta(bot, "git_repo", meta.repo);
      await this.setMeta(bot, "git_commit", meta.commit);
    }
  }

  private async computeGitStatus(bot: Bot): Promise<GitStatus | null> {
    const repo = this.getMeta(bot, "git_repo");
    const stored = this.getMeta(bot, "git_commit");
    if (!repo || !stored) return null;
    const workdir = resolve("storage/bots", bot.id);
    if (!existsSync(join(workdir, ".git"))) return null;
    await runCommand("git", ["fetch", "--depth=1"], workdir);
    const current = await runCommand("git", ["rev-parse", "HEAD"], workdir);
    const latest = await runCommand("git", ["rev-parse", "FETCH_HEAD"], workdir);
    return {
      repo,
      stored,
      current: current.trim(),
      latest: latest.trim(),
      updateAvailable: latest.trim() !== current.trim(),
    };
  }
  private async reconcileStatuses() {
    const bots = await this.botRepo.find();
    await this.refreshStatuses(bots);
  }

  private async refreshStatuses(bots: Bot[]) {
    for (const bot of bots) {
      try {
        const runtime = createRuntimeAdapter(bot.runtime);
        const statusRaw = await runtime.getStatus(bot.id);
        const normalized = this.normalizeStatus(statusRaw);
        if (normalized && bot.status !== normalized) {
          bot.status = normalized;
          await this.botRepo.save(bot);
          this.log.debug(`reconciled bot ${bot.id} -> ${normalized} (${statusRaw})`);
        }
      } catch (err) {
        console.error(`reconcile bot ${bot.id} failed`, err);
        bot.status = "failed";
        await this.botRepo.save(bot);
      }
    }
  }

  private normalizeStatus(statusRaw: string): BotStatus | null {
    const lowered = statusRaw.toLowerCase();
    if (lowered.includes("not-found") || lowered.includes("0/0") || lowered.includes("dead")) return "stopped";
    if (lowered.includes("running") || lowered.includes("1/1")) return "running";
    if (lowered.includes("pending") || lowered.includes("preparing")) return "created";
    return null;
  }

  private ensureRuntimeVersion(bot: Bot): string {
    if (!bot.runtimeVersion) {
      bot.runtimeVersion = CURRENT_RUNTIME_VERSION;
      void this.botRepo.save(bot);
    }
    return bot.runtimeVersion;
  }

  private envMap(bot: Bot): Record<string, string> {
    const envs: Record<string, string> = {};

    // Get allowed env from manifest
    const manifest = this.getBotManifest(bot.id);
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};

    bot.envs?.forEach((e) => {
      // Only include system env (BOT_TOKEN, DATABASE_URL) or env from manifest
      if (e.key === "BOT_TOKEN" || e.key === "DATABASE_URL" || e.key in allowedEnv) {
        envs[e.key] = e.value;
      }
    });

    return envs;
  }

  private compareSemver(a: string, b: string): number {
    const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
    const pa = parse(a || "0.0.0");
    const pb = parse(b || "0.0.0");
    for (let i = 0; i < 3; i += 1) {
      if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
      if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    }
    return 0;
  }

  private isRuntimeOutdated(bot: Bot): boolean {
    return this.compareSemver(this.ensureRuntimeVersion(bot), CURRENT_RUNTIME_VERSION) < 0;
  }

  private async getBotAdminIds(botId: string): Promise<{ ownerId?: string; adminIds: string[] }> {
    const accessList = await this.accessRepo.find({
      where: { bot: { id: botId } },
      relations: ["user"],
    });

    let ownerId: string | undefined;
    const adminIds: string[] = [];

    for (const access of accessList) {
      if (access.permission === "owner") {
        ownerId = access.user.telegramId.toString();
      } else if (["admin", "editor"].includes(access.permission)) {
        adminIds.push(access.user.telegramId.toString());
      }
    }

    return { ownerId, adminIds };
  }

  private serializeBot(bot: Bot) {
    const sourceType = this.getMeta(bot, "source_type") as SourceType | undefined;
    const gitVersion = this.getMeta(bot, "git_version");
    const sourcePath = this.getMeta(bot, "source_path");

    // Generate code from name if missing (for backward compatibility)
    const code = bot.code || this.slugify(bot.name) || `bot-${bot.id.slice(0, 8)}`;

    // Load manifest to get allowed env variables
    const manifest = this.getBotManifest(bot.id);
    const allowedEnv = manifest ? getAllowedEnvVariables(manifest) : {};

    return {
      ...bot,
      code,
      runtimeVersion: this.ensureRuntimeVersion(bot),
      latestRuntimeVersion: CURRENT_RUNTIME_VERSION,
      runtimeOutdated: this.isRuntimeOutdated(bot),
      sourceType,
      allowedEnv,
      ...(gitVersion && { gitVersion }),
      ...(sourcePath && { sourcePath }),
    };
  }

  private getBotManifest(botId: string) {
    try {
      const workdir = resolve("storage/bots", botId);
      const pkgPath = join(workdir, "package.json");
      if (!existsSync(pkgPath)) return null;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return loadBotManifest(workdir, pkg);
    } catch (err) {
      this.log.warn(`Failed to load manifest for bot ${botId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Auto-start bots that were running before server restart
   */
  async autoStartBots(): Promise<void> {
    await this.init();
    this.log.info("Starting auto-start process for bots...");

    try {
      // Find all bots that were in running state
      const runningBots = await this.botRepo.find({
        where: { status: "running" },
        relations: ["envs", "runtimeMeta"],
      });

      if (runningBots.length === 0) {
        this.log.info("No bots to auto-start");
        return;
      }

      this.log.info(`Found ${runningBots.length} bot(s) to auto-start`);

      // Start each bot
      const results = await Promise.allSettled(
        runningBots.map(async (bot) => {
          try {
            this.log.info(`Auto-starting bot: ${bot.name} (${bot.id})`);
            await this.startBot(bot.id);
            this.log.info(`✓ Bot ${bot.name} (${bot.id}) started successfully`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log.error(`✗ Failed to auto-start bot ${bot.name} (${bot.id}): ${errorMessage}`);

            // Update bot status to failed
            bot.status = "failed";
            await this.botRepo.save(bot);

            throw error;
          }
        })
      );

      // Summary
      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      this.log.info(`Auto-start complete: ${successful} successful, ${failed} failed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error(`Auto-start process error: ${errorMessage}`);
    }
  }
}

async function safeJson(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
