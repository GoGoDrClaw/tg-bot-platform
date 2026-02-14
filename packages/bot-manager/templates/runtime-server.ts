// Shared runtime server for bots (grammY, TypeScript template)
import express from "express";
import { Bot } from "grammy";

type LogLevel = "debug" | "info" | "warn" | "error";

const COLORS = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function createLogger(scope: string, minLevel: LogLevel = "info") {
  const threshold = LEVEL_ORDER[minLevel] ?? LEVEL_ORDER.info;
  return {
    debug: (msg: string, ...meta: unknown[]) => log("debug", msg, meta),
    info: (msg: string, ...meta: unknown[]) => log("info", msg, meta),
    warn: (msg: string, ...meta: unknown[]) => log("warn", msg, meta),
    error: (msg: string, ...meta: unknown[]) => log("error", msg, meta),
  };

  function log(level: LogLevel, message: string, meta: unknown[]) {
    if (LEVEL_ORDER[level] < threshold) return;
    const ts = new Date().toISOString();
    const levelColor =
      level === "debug" ? COLORS.gray : level === "info" ? COLORS.green : level === "warn" ? COLORS.yellow : COLORS.red;
    const metaStr = meta
      .filter((v) => v !== undefined && v !== null)
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(" ");
    console.log(
      `${COLORS.gray}${ts}${COLORS.reset} ${levelColor}[${level.toUpperCase()}]${COLORS.reset} ${COLORS.cyan}[${scope}]${COLORS.reset} ${message}${metaStr ? " " + metaStr : ""}`
    );
  }
}

const logLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const log = createLogger("runtime", logLevel);
const httpLog = createLogger("http", logLevel);
const tgLog = createLogger("telegram", logLevel);

const app = express();
app.use(express.json({ limit: "5mb" }));

const port = Number(process.env.PORT || 3000);
const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const localApiBase = (process.env.TELEGRAM_API_BASE || "http://bot-api:8081").replace(/\/$/, "");
if (!token) throw new Error("BOT_TOKEN is required");
if (!webhookUrl) throw new Error("WEBHOOK_URL is required");

const botModule = require("./dist/index.js");
const setupFn = botModule.default ?? botModule.bot ?? botModule;

if (typeof setupFn !== "function") {
  throw new Error("Export a setup function: (bot: Bot) => void");
}

const botInstance = new Bot(token, { client: { apiRoot: localApiBase } });
setupFn(botInstance);
const botInit = botInstance
  .init()
  .catch((err) => {
    log.error("bot init failed", err instanceof Error ? err.message : err);
    throw err;
  });

// enforce apiRoot to local bot api, guarding undefined
if (botInstance.api?.client?.options) {
  botInstance.api.client.options.apiRoot = localApiBase;
} else {
  log.warn("botInstance.api.client.options missing; skipping apiRoot override");
}

const handler = botInstance.handleUpdate.bind(botInstance);

if (!handler) {
  throw new Error("Bot module must export a grammY Bot instance or setup function(bot)");
}

process.on("unhandledRejection", (err) => log.error("unhandledRejection", err));
process.on("uncaughtException", (err) => log.error("uncaughtException", err));

app.post("/webhook", async (req, res) => {
  httpLog.debug("update received", { updateId: req.body?.update_id });
  try {
    await botInit;
    if (process.env.DEBUG === "true") {
      log.debug("incoming update payload", req.body);
    }
    await Promise.resolve(handler(req.body));
    res.sendStatus(200);
  } catch (err) {
    const payload = err instanceof Error ? { message: err.message, stack: err.stack } : err;
    log.error("handler error", payload);
    res.sendStatus(200);
  }
});

app.get("/health", (_req, res) => {
  httpLog.debug("health requested");
  res.json({ ok: true });
});

app.listen(port, async () => {
  log.info("runtime server listening", { port, webhookUrl, apiRoot: localApiBase });
});
