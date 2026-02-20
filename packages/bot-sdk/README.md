# @nikovonlas/bot-sdk

SDK для разработки Telegram ботов на платформе Bot Platform.

## Установка

```bash
npm install @nikovonlas/bot-sdk
```

## Использование

```typescript
import { createBot } from '@nikovonlas/bot-sdk';

const sdk = await createBot();

// Логирование
sdk.logger.info('Bot started');

// База данных
await sdk.db.query('SELECT * FROM users');

// Конфигурация
console.log(sdk.config.botId);
console.log(sdk.config.welcomeMessage); // кастомная env через configKey

// Интернационализация (i18n)
import { createI18n } from '@nikovonlas/bot-sdk';

const translations = {
  'en-US': {
    welcome: 'Welcome!',
    greeting: 'Hello, {name}!',
  },
  'ru-RU': {
    welcome: 'Добро пожаловать!',
    greeting: 'Привет, {name}!',
  },
};

const i18n = createI18n(translations, 'en-US');
i18n.setLanguage(sdk.config.language || 'en-US'); // из env переменной
console.log(i18n.t('greeting', { name: 'John' }));
console.log(i18n.formatDateTime(new Date()));
```

## Документация

📚 [Полная документация](https://github.com/NikoVonLas/tg-bot-platform/blob/main/docs/bot-sdk.md)

## Лицензия

MIT
