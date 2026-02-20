import { loadConfig, BotConfig } from "./config";
import { BotLogger } from "./logger";
import { BotDatabase, createDatabase } from "./database";

export interface BotSDK {
  config: BotConfig;
  logger: BotLogger;
  db: BotDatabase;
  close(): Promise<void>;
}

export interface CreateBotOptions {
  enableDatabase?: boolean;
}

export async function createBot(options: CreateBotOptions = {}): Promise<BotSDK> {
  const config = loadConfig();
  const debugEnabled = process.env.DEBUG === "true" || process.env.LOG_LEVEL === "debug";
  const logger = new BotLogger(config, "bot", debugEnabled);

  logger.info("Initializing bot", {
    botId: config.botId,
    port: config.port,
  });

  const db = createDatabase(config, logger);

  if (options.enableDatabase !== false && config.databaseUrl) {
    await db.connect();
  }

  const sdk: BotSDK = {
    config,
    logger,
    db,
    async close() {
      logger.info("Shutting down bot");
      await logger.flush();
      await db.disconnect();
      await logger.close();
    },
  };

  return sdk;
}
