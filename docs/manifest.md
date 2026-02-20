# Манифест бота

Манифест бота определяется в `package.json` в секции `bot`.

## Формат

```json
{
  "name": "my-awesome-bot",
  "version": "1.0.0",
  "keywords": ["telegram", "bot"],
  "dependencies": {
    "@bot-platform/bot-sdk": "^1.0.0",
    "grammy": "^1.23.0"
  },
  "bot": {
    "type": "telegram",
    "env": {
      "VARIABLE_NAME": {
        "required": true,
        "description": "Description of the variable",
        "default": "default value",
        "configKey": "variableName"
      }
    },
    "os-packages": ["imagemagick", "ffmpeg"]
  }
}
```

## Поля манифеста

### `type` (required)
Тип бота. Сейчас поддерживается только `"telegram"`.

```json
"type": "telegram"
```

---

### `env` (optional)
Словарь environment переменных, которые можно настроить через UI.

**Важно:**
- Системные переменные (`BOT_TOKEN`, `DATABASE_URL`, `BOT_ID` и т.д.) НЕ должны быть в манифесте
- Указывайте только кастомные переменные вашего бота

#### Формат переменной:

```json
"VARIABLE_NAME": {
  "required": boolean,      // Обязательная ли переменная
  "description": string,    // Описание для UI
  "default": string,        // Значение по умолчанию
  "configKey": string       // Имя для доступа в sdk.config
}
```

#### Пример:

```json
"env": {
  "DEBUG": {
    "required": false,
    "description": "Enable debug logging (true/false)",
    "default": "false",
    "configKey": "debug"
  },
  "MAX_RETRIES": {
    "required": true,
    "description": "Maximum number of retry attempts",
    "default": "3",
    "configKey": "maxRetries"
  },
  "API_URL": {
    "required": true,
    "description": "External API endpoint",
    "configKey": "apiUrl"
  }
}
```

#### configKey

Позволяет задать удобное имя для доступа к переменной в коде:

```typescript
// В манифесте:
"MAX_RETRIES": {
  "configKey": "maxRetries"  // camelCase
}

// В коде:
sdk.config.maxRetries       // ✅ удобно
sdk.config.env.MAX_RETRIES  // ✅ тоже работает
```

---

### `os-packages` (optional)
Список системных пакетов, которые нужно установить в контейнер бота.

```json
"os-packages": ["imagemagick", "ffmpeg", "libpq-dev"]
```

Пакеты устанавливаются через `apt-get` при сборке Docker образа.

**Примеры использования:**
- `imagemagick` - обработка изображений
- `ffmpeg` - обработка видео/аудио
- `libpq-dev` - для работы с PostgreSQL
- `build-essential` - компиляторы для native модулей

---

## Валидация

При создании бота манифест проходит валидацию:

### ✅ Валидный манифест:
```json
{
  "bot": {
    "type": "telegram",
    "env": {
      "DEBUG": {
        "required": false,
        "description": "Enable debug mode",
        "default": "false",
        "configKey": "debug"
      }
    }
  }
}
```

### ❌ Ошибки валидации:

**BOT_TOKEN в манифесте:**
```json
"env": {
  "BOT_TOKEN": { ... }  // ❌ Ошибка: системная переменная
}
```

**Неправильный type:**
```json
"type": "discord"  // ❌ Ошибка: только "telegram" поддерживается
```

**Неправильный формат env:**
```json
"env": {
  "DEBUG": "false"  // ❌ Ошибка: должен быть объект с полями
}
```

---

## Примеры

### Минимальный манифест:
```json
{
  "bot": {
    "type": "telegram"
  }
}
```

### С переменными окружения:
```json
{
  "bot": {
    "type": "telegram",
    "env": {
      "WELCOME_MESSAGE": {
        "required": false,
        "description": "Custom welcome message for /start",
        "default": "Hello! 👋",
        "configKey": "welcomeMessage"
      },
      "ADMIN_CHAT_ID": {
        "required": true,
        "description": "Telegram chat ID for admin notifications",
        "configKey": "adminChatId"
      }
    }
  }
}
```

### С системными пакетами:
```json
{
  "bot": {
    "type": "telegram",
    "env": {
      "ENABLE_VOICE": {
        "required": false,
        "description": "Enable voice message processing",
        "default": "false",
        "configKey": "enableVoice"
      }
    },
    "os-packages": ["ffmpeg"]
  }
}
```

---

## См. также

- [Bot SDK документация](./bot-sdk.md) - использование переменных в коде
- [Environment переменные](./environment.md) - системные и кастомные env
