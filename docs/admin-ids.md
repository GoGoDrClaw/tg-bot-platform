# Admin IDs в Bot Platform

Bot Platform автоматически прокидывает Telegram ID администраторов в каждый запущенный бот как environment variables.

## Environment Variables

### `BOT_OWNER_ID`
Telegram ID владельца бота (тот, кто создал бота в Bot Platform).

**Пример:** `123456789`

### `BOT_ADMIN_IDS`
Comma-separated список Telegram ID всех остальных администраторов и редакторов (пользователи с правами `admin` или `editor`).

**Пример:** `987654321,555666777,111222333`

## Использование в боте

### Проверка прав администратора

```typescript
// src/index.ts
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!);

// Получаем ID администраторов из environment
const OWNER_ID = process.env.BOT_OWNER_ID
  ? Number(process.env.BOT_OWNER_ID)
  : null;

const ADMIN_IDS = process.env.BOT_ADMIN_IDS
  ? process.env.BOT_ADMIN_IDS.split(",").map(id => Number(id))
  : [];

// Все админы (владелец + остальные)
const ALL_ADMIN_IDS = OWNER_ID
  ? [OWNER_ID, ...ADMIN_IDS]
  : ADMIN_IDS;

// Middleware для проверки прав
function isAdmin(ctx: any) {
  const userId = ctx.from?.id;
  return userId && ALL_ADMIN_IDS.includes(userId);
}

function isOwner(ctx: any) {
  const userId = ctx.from?.id;
  return userId && userId === OWNER_ID;
}

// Команда только для админов
bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("❌ Эта команда только для администраторов");
  }

  await ctx.reply("✅ Привет, админ!");
});

// Команда только для владельца
bot.command("owner", async (ctx) => {
  if (!isOwner(ctx)) {
    return ctx.reply("❌ Эта команда только для владельца бота");
  }

  await ctx.reply("✅ Привет, владелец!");
});

// Список администраторов
bot.command("admins", async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply("❌ Эта команда только для администраторов");
  }

  let message = "👥 **Администраторы бота:**\n\n";

  if (OWNER_ID) {
    message += `👑 Владелец: ${OWNER_ID}\n`;
  }

  if (ADMIN_IDS.length > 0) {
    message += `\n⭐️ Администраторы:\n`;
    ADMIN_IDS.forEach(id => {
      message += `• ${id}\n`;
    });
  }

  await ctx.reply(message);
});

bot.start();
```

### Пример с Telegraf

```typescript
import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.BOT_TOKEN!);

const OWNER_ID = process.env.BOT_OWNER_ID
  ? Number(process.env.BOT_OWNER_ID)
  : null;

const ADMIN_IDS = process.env.BOT_ADMIN_IDS
  ? process.env.BOT_ADMIN_IDS.split(",").map(Number)
  : [];

const ALL_ADMIN_IDS = OWNER_ID ? [OWNER_ID, ...ADMIN_IDS] : ADMIN_IDS;

// Middleware для админов
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  ctx.state.isAdmin = userId && ALL_ADMIN_IDS.includes(userId);
  ctx.state.isOwner = userId && userId === OWNER_ID;
  return next();
});

bot.command("secret", (ctx) => {
  if (!ctx.state.isAdmin) {
    return ctx.reply("🚫 Access denied");
  }
  ctx.reply("🔐 Secret admin content");
});

bot.launch();
```

### Пример с node-telegram-bot-api

```javascript
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const OWNER_ID = process.env.BOT_OWNER_ID
  ? Number(process.env.BOT_OWNER_ID)
  : null;

const ADMIN_IDS = process.env.BOT_ADMIN_IDS
  ? process.env.BOT_ADMIN_IDS.split(",").map(Number)
  : [];

const ALL_ADMIN_IDS = OWNER_ID ? [OWNER_ID, ...ADMIN_IDS] : ADMIN_IDS;

function isAdmin(msg) {
  return ALL_ADMIN_IDS.includes(msg.from.id);
}

bot.onText(/\/admin/, (msg) => {
  if (!isAdmin(msg)) {
    return bot.sendMessage(msg.chat.id, "❌ Admin only");
  }

  bot.sendMessage(msg.chat.id, "✅ Hello admin!");
});
```

## Динамическое обновление

При изменении прав доступа через Bot Platform UI (добавление/удаление администраторов), изменения вступят в силу после **перезапуска бота**:

1. Остановите бот через UI
2. Запустите бот снова
3. Новые значения `BOT_OWNER_ID` и `BOT_ADMIN_IDS` будут применены

## Безопасность

⚠️ **Важно:** Не полагайтесь только на эти переменные для критичной безопасности. Это удобный способ ограничить доступ, но:

- ID можно узнать из публичных сообщений
- Используйте дополнительные проверки для sensitive операций
- Логируйте административные действия

## FAQ

**Q: Что если у бота нет владельца?**
A: `BOT_OWNER_ID` не будет установлен (undefined). Проверяйте перед использованием.

**Q: Что если нет других админов?**
A: `BOT_ADMIN_IDS` будет пустой строкой или не будет установлен.

**Q: Можно ли изменить эти переменные вручную?**
A: Нет, они генерируются автоматически на основе BotAccess в базе данных.

**Q: Как добавить администратора?**
A: Через UI Bot Platform → выберите бота → "Manage Access" → добавьте пользователя с правами "admin" или "editor".
