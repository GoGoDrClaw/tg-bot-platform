export interface BotConfig {
  botId: string;
  token: string;
  port: number;
  webhookUrl: string;
  telegramApiBase: string;
  ownerId?: string;
  adminIds: string[];
  managerUrl: string;
  databaseUrl?: string;
  env: Record<string, string>;
  [key: string]: any; // Allow dynamic properties for configKey mappings
}

export function loadConfig(): BotConfig {
  const botId = process.env.BOT_ID;
  const token = process.env.BOT_TOKEN;
  const port = process.env.PORT;
  const webhookUrl = process.env.WEBHOOK_URL;
  const telegramApiBase = process.env.TELEGRAM_API_BASE;
  const managerUrl = process.env.BOT_MANAGER_URL || "http://bot-manager:3000";
  const databaseUrl = process.env.DATABASE_URL;

  if (!botId || !token || !port || !webhookUrl || !telegramApiBase) {
    throw new Error(
      "Missing required environment variables: BOT_ID, BOT_TOKEN, PORT, WEBHOOK_URL, TELEGRAM_API_BASE"
    );
  }

  const adminIdsRaw = process.env.BOT_ADMIN_IDS || "";
  const adminIds = adminIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // Collect all custom env variables
  // Bot manager already filters env to only include allowed variables from manifest
  const customEnv: Record<string, string> = {};
  const systemEnvKeys = new Set([
    "BOT_ID",
    "BOT_TOKEN",
    "PORT",
    "WEBHOOK_URL",
    "TELEGRAM_API_BASE",
    "BOT_MANAGER_URL",
    "DATABASE_URL",
    "BOT_OWNER_ID",
    "BOT_ADMIN_IDS",
  ]);

  for (const [key, value] of Object.entries(process.env)) {
    if (!systemEnvKeys.has(key) && value !== undefined) {
      customEnv[key] = value;
    }
  }

  // Parse env config mapping from BOT_ENV_CONFIG
  const envConfigMap: Record<string, string> = {};
  if (process.env.BOT_ENV_CONFIG) {
    try {
      const parsed = JSON.parse(process.env.BOT_ENV_CONFIG);
      Object.assign(envConfigMap, parsed);
    } catch (err) {
      console.error("Failed to parse BOT_ENV_CONFIG:", err);
    }
  }

  // Create config object with base properties
  const config: BotConfig = {
    botId,
    token,
    port: parseInt(port, 10),
    webhookUrl,
    telegramApiBase,
    ownerId: process.env.BOT_OWNER_ID,
    adminIds,
    managerUrl,
    databaseUrl,
    env: customEnv,
  };

  // Add convenient aliases for env variables based on configKey
  for (const [envKey, configKey] of Object.entries(envConfigMap)) {
    if (customEnv[envKey] !== undefined) {
      config[configKey] = customEnv[envKey];
    }
  }

  return config;
}
