# Bot Platform

PaaS для разработки и деплоя Telegram ботов.

## Особенности

- 🚀 **Простой деплой** - из git, zip или локальной директории
- 🔒 **Изоляция** - каждый бот с собственной БД (SQLite/PostgreSQL)
- 📊 **Централизованное логирование** - логи в UI и БД
- ⚙️ **Управление конфигурацией** - env переменные через манифест
- 🎯 **Runtime на выбор** - Docker, Swarm, Kubernetes

## Быстрый старт

```bash
# Клонировать репозиторий
git clone <repository>
cd bot-platform

# Настроить окружение
cp .env.example .env
# Отредактируйте .env

# Запустить
docker compose up -d

# Открыть UI
open http://localhost:3000
```

## Документация

📚 **[Полная документация →](./docs/)**

- [Быстрый старт](./docs/#установка-и-запуск)
- [Bot SDK](./docs/bot-sdk.md) - разработка ботов
- [Манифест бота](./docs/manifest.md) - конфигурация
- [Environment переменные](./docs/environment.md) - системные и кастомные env

## Архитектура

```
Web UI ─→ Bot Manager ─┬─→ Bot 1 (container + isolated DB)
                       ├─→ Bot 2 (container + isolated DB)
                       └─→ Bot N (container + isolated DB)
                              ↓
                       Telegram Bot API
```

## Разработка

```bash
# Установить зависимости
npm install

# Собрать проект
npm run build

# Запустить dev режим
npm run dev:api
```

## Лицензия

MIT
