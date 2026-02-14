import { DeployRequest, RuntimeAdapter } from "../types";
import { runCommand } from "../utils";
import { createLogger } from "../logger";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const log = createLogger("DockerAdapter");

const DEFAULT_CPU_LIMIT = "0.5";
const DEFAULT_MEMORY_LIMIT = "256m";
const LOG_DIR = resolve(process.cwd(), "storage", "bot-logs");
const NETWORK = process.env.DOCKER_NETWORK || "bot-platform_botnet";
const CONTAINER_PORT = Number(process.env.RUNTIME_PORT ?? "8080");
const BOT_API_FILES_VOLUME =
  process.env.BOT_API_FILES_VOLUME ||
  (process.env.COMPOSE_PROJECT_NAME ? `${process.env.COMPOSE_PROJECT_NAME}_bot_api_files` : null) ||
  "bot-platform_bot_api_files";

export class DockerAdapter implements RuntimeAdapter {
  private containerName(botId: string): string {
    return `bot-${botId}`;
  }

  async deployBot(request: DeployRequest): Promise<void> {
    log.info(`deploy ${request.botId} image=${request.imageName} port=${request.port}`);
    const name = this.containerName(request.botId);
    await this.persistLogs(request.botId);
    await this.stopBot(request.botId); // cleanup existing

    const envArgs = Object.entries(request.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const limits = request.resources ?? {};

    const args = [
      "run",
      "-d",
      "--restart",
      "unless-stopped",
      "--name",
      name,
      "--network",
      NETWORK,
      "--cpus",
      limits.cpu ?? DEFAULT_CPU_LIMIT,
      "--memory",
      limits.memory ?? DEFAULT_MEMORY_LIMIT,
      "-e",
      `PORT=${CONTAINER_PORT}`,
      ...envArgs,
    ];

    if (BOT_API_FILES_VOLUME) {
      args.push("--mount", `type=volume,src=${BOT_API_FILES_VOLUME},dst=/var/lib/telegram-bot-api,ro`);
      log.info(`mounting bot-api files volume ${BOT_API_FILES_VOLUME} -> /var/lib/telegram-bot-api`);
    }

    args.push(request.imageName);

    await runCommand("docker", args);
  }

  async stopBot(botId: string): Promise<void> {
    const name = this.containerName(botId);
    await this.persistLogs(botId);
    await runCommand("docker", ["rm", "-f", name]).catch(() => undefined);
    log.info(`stopped ${name}`);
  }

  async restartBot(botId: string): Promise<void> {
    const name = this.containerName(botId);
    await runCommand("docker", ["restart", name]);
    log.info(`restart issued ${name}`);
  }

  async getStatus(botId: string): Promise<string> {
    const name = this.containerName(botId);
    const output = await runCommand("docker", ["inspect", "-f", "{{.State.Status}}", name]).catch(
      () => "not-found"
    );
    return output.trim();
  }

  async getLogs(botId: string, tail = 100): Promise<string> {
    const name = this.containerName(botId);
    const persisted = this.readPersistedLogs(botId);
    const live = await runCommand("docker", ["logs", `--tail=${tail}`, name]).catch(() => "");
    const merged = `${persisted}${persisted && live ? "\n" : ""}${live}`.split("\n");
    const sliced = merged.slice(Math.max(0, merged.length - tail));
    return sliced.join("\n");
  }

  private ensureLogDir() {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  private readPersistedLogs(botId: string): string {
    try {
      const file = resolve(LOG_DIR, `${botId}.log`);
      if (!existsSync(file)) return "";
      return readFileSync(file, "utf-8");
    } catch {
      return "";
    }
  }

  private async persistLogs(botId: string) {
    this.ensureLogDir();
    const name = this.containerName(botId);
    const existing = this.readPersistedLogs(botId);
    const dockerLogs = await runCommand("docker", ["logs", name]).catch(() => "");
    if (!dockerLogs && existing) return;
    const file = resolve(LOG_DIR, `${botId}.log`);
    const merged = existing ? `${existing}${existing.endsWith("\n") ? "" : "\n"}${dockerLogs}` : dockerLogs;
    writeFileSync(file, merged, "utf-8");
  }
}
