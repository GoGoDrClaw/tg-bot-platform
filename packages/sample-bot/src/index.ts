import { Bot } from "grammy";
import { createBot, createI18n } from "@nikovonlas/bot-sdk";

// Translations
const translations = {
  'en-US': {
    botInitialized: 'Sample bot initialized',
    startCommand: 'start command received',
    welcome: 'Welcome! 👋\n\nI am a sample bot running on Bot Platform.',
    dbCommandExecuted: 'db command executed',
    messageSaved: 'Message saved! Total messages in DB: {count}',
    dbError: 'Database error: {error}',
    textMessageReceived: 'text message received',
    echo: 'Echo: {text}',
    sdkNotInitialized: 'SDK not initialized',
  },
  'ru-RU': {
    botInitialized: 'Sample бот инициализирован',
    startCommand: 'получена команда start',
    welcome: 'Добро пожаловать! 👋\n\nЯ sample бот, работающий на Bot Platform.',
    dbCommandExecuted: 'команда db выполнена',
    messageSaved: 'Сообщение сохранено! Всего сообщений в БД: {count}',
    dbError: 'Ошибка базы данных: {error}',
    textMessageReceived: 'получено текстовое сообщение',
    echo: 'Эхо: {text}',
    sdkNotInitialized: 'SDK не инициализирован',
  },
};

// Initialize i18n
const i18n = createI18n(translations, 'en-US');

// Initialize SDK
const sdk = createBot().catch((err) => {
  console.error("Failed to initialize bot SDK:", err);
  return null;
});

// Set language from config
sdk.then((s) => {
  if (s?.config.language) {
    i18n.setLanguage(s.config.language);
  }
});

export default function setup(bot: Bot) {
  // Log bot initialization
  sdk.then((s) => s?.logger.info(i18n.t('botInitialized')));

  bot.command("start", async (ctx) => {
    const s = await sdk;
    s?.logger.info(i18n.t('startCommand'), { userId: ctx.from?.id });

    // Use custom welcome message from env or default i18n translation
    const welcomeMessage = s?.config.welcomeMessage || i18n.t('welcome');
    await ctx.reply(welcomeMessage);
  });

  bot.command("db", async (ctx) => {
    const s = await sdk;
    if (!s) {
      return ctx.reply(i18n.t('sdkNotInitialized'));
    }

    try {
      // Create table if not exists
      await s.db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          text TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert message
      await s.db.run(
        "INSERT INTO messages (user_id, text) VALUES (?, ?)",
        [ctx.from?.id || 0, ctx.message?.text || ""]
      );

      // Count messages
      const result = await s.db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM messages"
      );
      const count = result.rows[0]?.count || 0;

      s.logger.info(i18n.t('dbCommandExecuted'), { userId: ctx.from?.id, totalMessages: count });
      await ctx.reply(i18n.t('messageSaved', { count: String(count) }));
    } catch (err) {
      s.logger.error("db command failed", { error: err instanceof Error ? err.message : String(err) });
      await ctx.reply(i18n.t('dbError', { error: err instanceof Error ? err.message : "Unknown error" }));
    }
  });

  bot.on("message:text", async (ctx) => {
    const s = await sdk;
    s?.logger.debug(i18n.t('textMessageReceived'), { text: ctx.message.text });
    await ctx.reply(i18n.t('echo', { text: ctx.message.text }));
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    const s = await sdk;
    if (s) {
      await s.close();
    }
    process.exit(0);
  });
}
