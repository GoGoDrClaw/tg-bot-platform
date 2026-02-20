# @bot-platform/bot-sdk

SDK for building Telegram bots on Bot Platform.

## Features

- **🪵 Centralized Logging** - Logs are automatically sent to Bot Manager and stored in database
- **🗄️ Isolated Database** - Each bot gets its own isolated database (SQLite or PostgreSQL schema)
- **⚙️ Configuration** - Easy access to bot environment variables
- **📦 TypeScript** - Fully typed for better developer experience

## Installation

```bash
npm install @bot-platform/bot-sdk
```

## Quick Start

```typescript
import { Bot } from "grammy";
import { createBot } from "@bot-platform/bot-sdk";

// Initialize SDK
const sdk = await createBot();

export default function setup(bot: Bot) {
  // Log bot initialization
  sdk.logger.info("Bot initialized");

  bot.command("start", async (ctx) => {
    sdk.logger.info("start command received", { userId: ctx.from?.id });
    await ctx.reply("Hello! 👋");
  });

  bot.on("message", async (ctx) => {
    sdk.logger.debug("message received", { text: ctx.message.text });
  });
}
```

## API Reference

### `createBot(options?)`

Creates and initializes the Bot SDK.

**Options:**
- `enableDatabase?: boolean` - Enable database connection (default: true if DATABASE_URL is set)

**Returns:** `Promise<BotSDK>`

```typescript
const sdk = await createBot({
  enableDatabase: true
});
```

### `BotSDK`

#### `sdk.config`

Access to bot configuration from environment variables:

```typescript
sdk.config.botId        // Bot ID
sdk.config.token        // Bot Token
sdk.config.port         // Runtime port
sdk.config.webhookUrl   // Webhook URL
sdk.config.ownerId      // Bot owner Telegram ID
sdk.config.adminIds     // Array of admin Telegram IDs
sdk.config.managerUrl   // Bot Manager URL
sdk.config.databaseUrl  // Database connection URL
```

#### `sdk.logger`

Centralized logger with colored output that sends logs to Bot Manager:

```typescript
sdk.logger.debug("Debug message", { data: "..." });
sdk.logger.info("Info message", { userId: 123 });
sdk.logger.warn("Warning message");
sdk.logger.error("Error message", { error: err });
```

**Features:**
- 🎨 **Colored console output** (cyan for info, yellow for warn, red for error, magenta for debug)
- 📦 **Metadata support** - attach structured data to logs
- 🏷️ **Scoped logging** - create child loggers with different scopes
- 📤 **Auto-flush** - logs buffered and sent to Bot Manager in batches
- 💾 **Persistent** - stored in database for later viewing

**Log format with colors:**
```
[2026-02-14T12:30:45.123Z] INFO  [bot] Bot started                    # cyan
[2026-02-14T12:30:45.456Z] DEBUG [sqlite] Database connected           # magenta
[2026-02-14T12:30:45.789Z] INFO  [bot] Command received {"cmd":"start"} # cyan
[2026-02-14T12:30:46.012Z] WARN  [bot] Rate limit approaching          # yellow
[2026-02-14T12:30:46.345Z] ERROR [bot] Handler failed {"error":"..."}  # red
```

**Child loggers:**
```typescript
// Create scoped loggers for different modules
const dbLogger = sdk.logger.child("database");
const apiLogger = sdk.logger.child("api");

dbLogger.info("Connected"); // [2026-...] INFO  [database] Connected
apiLogger.info("Request received"); // [2026-...] INFO  [api] Request received
```

**Debug mode:**
Debug logs are only shown when:
- `DEBUG=true` environment variable is set, OR
- `LOG_LEVEL=debug` environment variable is set

```typescript
// Only shown if DEBUG=true or LOG_LEVEL=debug
sdk.logger.debug("Detailed debug info", { state: "..." });
```

#### `sdk.db`

Isolated database for your bot. Each bot has its own database:
- **SQLite**: Separate `.db` file
- **PostgreSQL**: Separate schema with dedicated user

```typescript
// Create table
await sdk.db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Insert data
await sdk.db.run(
  "INSERT INTO users (id, name) VALUES (?, ?)",
  [123, "John"]
);

// Query data
const result = await sdk.db.query<{ id: number; name: string }>(
  "SELECT * FROM users WHERE id = ?",
  [123]
);

console.log(result.rows); // [{ id: 123, name: "John" }]
console.log(result.rowCount); // 1
```

**Database Methods:**

- `db.query<T>(sql, params?)` - Execute SELECT query, returns `{ rows: T[], rowCount: number }`
- `db.run(sql, params?)` - Execute INSERT/UPDATE/DELETE query
- `db.connect()` - Connect to database (called automatically)
- `db.disconnect()` - Disconnect from database

#### `sdk.close()`

Cleanup and graceful shutdown:

```typescript
await sdk.close(); // Flushes logs, closes database connection
```

## Examples

### Using Database

```typescript
import { Bot } from "grammy";
import { createBot } from "@bot-platform/bot-sdk";

const sdk = await createBot();

export default function setup(bot: Bot) {
  bot.command("save", async (ctx) => {
    try {
      await sdk.db.run(
        "INSERT INTO messages (user_id, text) VALUES (?, ?)",
        [ctx.from?.id, ctx.message?.text]
      );

      const result = await sdk.db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM messages"
      );

      await ctx.reply(`Saved! Total: ${result.rows[0].count}`);
    } catch (err) {
      sdk.logger.error("Failed to save message", { error: err });
      await ctx.reply("Error saving message");
    }
  });
}
```

### Access Control

```typescript
import { Bot } from "grammy";
import { createBot } from "@bot-platform/bot-sdk";

const sdk = await createBot();

// Check if user is owner or admin
function isAuthorized(userId: number): boolean {
  return (
    sdk.config.ownerId === String(userId) ||
    sdk.config.adminIds.includes(String(userId))
  );
}

export default function setup(bot: Bot) {
  bot.command("admin", async (ctx) => {
    if (!isAuthorized(ctx.from?.id || 0)) {
      return ctx.reply("❌ Access denied");
    }

    await ctx.reply("✅ Admin action executed");
  });
}
```

### Graceful Shutdown

```typescript
import { Bot } from "grammy";
import { createBot } from "@bot-platform/bot-sdk";

const sdk = await createBot();

export default function setup(bot: Bot) {
  // ... bot handlers ...

  // Cleanup on shutdown
  process.on("SIGINT", async () => {
    sdk.logger.info("Shutting down...");
    await sdk.close();
    process.exit(0);
  });
}
```

## Environment Variables

The SDK automatically reads these environment variables:

**Required:**
- `BOT_ID` - Bot unique identifier
- `BOT_TOKEN` - Telegram bot token
- `PORT` - Runtime server port
- `WEBHOOK_URL` - Webhook URL for Telegram
- `TELEGRAM_API_BASE` - Telegram API base URL

**Optional:**
- `BOT_OWNER_ID` - Bot owner Telegram user ID
- `BOT_ADMIN_IDS` - Comma-separated admin Telegram user IDs
- `BOT_MANAGER_URL` - Bot Manager URL (default: http://bot-manager:3000)
- `DATABASE_URL` - Database connection URL (sqlite:// or postgresql://)

## Security

### Database Isolation

Each bot has **complete isolation** from other bots:

**SQLite:**
- Separate `.db` file per bot
- Physical file system isolation
- Mounted as read-write volume to bot container

**PostgreSQL:**
- Dedicated schema per bot (`bot_{botId}`)
- Dedicated database user per bot
- User has access ONLY to their schema
- Cannot read/write other bots' data
- Cannot access platform tables (users, bots, etc.)

Example PostgreSQL isolation:
```sql
-- Bot abc123 can only access schema bot_abc123
-- All queries automatically scoped to bot_abc123 schema
-- No access to public schema or other bot schemas
```

## License

MIT
