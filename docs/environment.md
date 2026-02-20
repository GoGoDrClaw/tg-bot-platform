# Environment переменные

## Типы переменных

В Bot Platform есть два типа environment переменных:

### 1. Системные переменные
Управляются платформой, прокидываются автоматически:

| Переменная | Описание | Пример |
|------------|----------|--------|
| `BOT_ID` | Уникальный ID бота | `"abc123-def456-..."` |
| `BOT_TOKEN` | Telegram bot token | `"123456:ABC-DEF..."` |
| `PORT` | Порт для webhook сервера | `"8080"` |
| `WEBHOOK_URL` | URL для Telegram webhooks | `"http://bot-manager:3000/w/abc123"` |
| `TELEGRAM_API_BASE` | URL локального Bot API | `"http://bot-api:8081"` |
| `BOT_MANAGER_URL` | URL bot-manager | `"http://bot-manager:3000"` |
| `DATABASE_URL` | Строка подключения к БД | `"sqlite:///app/data/bot.db"` или `"postgresql://..."` |
| `BOT_OWNER_ID` | Telegram ID владельца | `"123456789"` |
| `BOT_ADMIN_IDS` | Telegram IDs админов | `"123456789,987654321"` |
| `BOT_ENV_CONFIG` | Mapping для configKey | `'{"DEBUG":"debug"}'` |

**Эти переменные НЕ должны быть в манифесте бота!**

---

### 2. Кастомные переменные
Определяются в манифесте бота, настраиваются через UI:

```json
{
  "bot": {
    "env": {
      "DEBUG": {
        "required": false,
        "description": "Enable debug logging",
        "default": "false",
        "configKey": "debug"
      },
      "API_KEY": {
        "required": true,
        "description": "External API key",
        "configKey": "apiKey"
      }
    }
  }
}
```

---

## Доступ к переменным в коде

### Системные переменные

Доступны через `sdk.config`:

```typescript
import { createBot } from '@bot-platform/bot-sdk';

const sdk = await createBot();

// Системные переменные
sdk.config.botId           // BOT_ID
sdk.config.token           // BOT_TOKEN
sdk.config.port            // PORT
sdk.config.webhookUrl      // WEBHOOK_URL
sdk.config.ownerId         // BOT_OWNER_ID
sdk.config.adminIds        // BOT_ADMIN_IDS (массив)
sdk.config.databaseUrl     // DATABASE_URL
```

---

### Кастомные переменные

Доступны двумя способами:

#### 1. Через configKey (рекомендуется):
```typescript
// В манифесте:
"DEBUG": {
  "configKey": "debug"
}

// В коде:
sdk.config.debug  // ✅ удобно, camelCase
```

#### 2. Через env (оригинальное имя):
```typescript
sdk.config.env.DEBUG  // ✅ работает всегда
```

---

## Примеры использования

### Проверка debug режима
```typescript
const sdk = await createBot();

if (sdk.config.debug === "true") {
  sdk.logger.debug("Debug mode enabled");
}
```

### Использование API ключа
```typescript
const sdk = await createBot();

const apiKey = sdk.config.apiKey;
if (!apiKey) {
  throw new Error("API_KEY is required");
}

const response = await fetch(sdk.config.apiUrl, {
  headers: {
    'Authorization': `Bearer ${apiKey}`
  }
});
```

### Проверка прав доступа
```typescript
function isAdmin(userId: number): boolean {
  const sdk = await createBot();

  // Владелец
  if (sdk.config.ownerId === String(userId)) {
    return true;
  }

  // Админ
  if (sdk.config.adminIds.includes(String(userId))) {
    return true;
  }

  return false;
}
```

---

## Безопасность

### ✅ Хорошие практики:

1. **Не логируйте токены:**
   ```typescript
   // ❌ Плохо
   sdk.logger.info("Token:", sdk.config.token);

   // ✅ Хорошо
   sdk.logger.info("Bot authenticated");
   ```

2. **Не сохраняйте токены в БД:**
   ```typescript
   // ❌ Плохо
   await sdk.db.run("INSERT INTO config (key, value) VALUES (?, ?)",
     ["token", sdk.config.token]);

   // ✅ Хорошо - токен уже в env, не нужно сохранять
   ```

3. **Проверяйте права доступа:**
   ```typescript
   bot.command("admin", async (ctx) => {
     if (!isAdmin(ctx.from.id)) {
       return ctx.reply("Access denied");
     }
     // admin action
   });
   ```

### 🔒 Изоляция

- Каждый бот видит **только** свои env переменные
- Токены других ботов недоступны
- База данных изолирована (отдельный файл/схема)

---

## Настройка через UI

### При создании бота:
1. Создайте бота в UI
2. Укажите BOT_TOKEN
3. (Опционально) Добавьте кастомные env из манифеста

### После создания:
1. Откройте карточку бота
2. Нажмите "Edit env"
3. Измените значения разрешённых переменных
4. Сохраните

**Важно:** Можно изменить только переменные из манифеста. Системные переменные недоступны для редактирования.

---

## Переменные платформы

Эти переменные настраиваются в `.env` файле платформы:

```bash
# Bot Manager
API_PORT=3000
WEBHOOK_BASE_URL=http://bot-manager:3000/w

# Database
DB_TYPE=sqlite  # или postgres
SQLITE_PATH=storage/data.sqlite
DB_URL=postgres://user:pass@host/db

# Telegram API
TELEGRAM_API_BASE=http://bot-api:8081

# Auth
JWT_SECRET=your-secret
TELEGRAM_WIDGET_BOT_TOKEN=token

# Runtime
RUNTIME_VERSION=1.2.0
BOT_MANAGER_URL=http://bot-manager:3000
```

---

## См. также

- [Манифест бота](./manifest.md) - определение кастомных env
- [Bot SDK](./bot-sdk.md) - использование в коде
- [Безопасность](./security.md) - изоляция и защита
