# Bot Update System

Платформа поддерживает обновление ботов в зависимости от типа источника (git, zip, local).

## Типы источников и обновлений

### 1. Git Source (Репозиторий)

**Рекомендуемый способ** для production ботов.

#### Как работает:
- При создании бота система клонирует репозиторий и проверяет наличие release tags
- Если есть релизы (теги), используется последняя версия (например, `v1.0.0`)
- Если релизов нет, используется `main`/`master` ветка с **предупреждением**

#### Проверка обновлений:
```bash
GET /bots/:id/update/status
```

Ответ для git-бота:
```json
{
  "sourceType": "git",
  "repo": "https://github.com/user/bot.git",
  "current": "abc123def",
  "latest": "xyz789abc",
  "updateAvailable": true,
  "updateType": "release",
  "currentVersion": "v1.0.0",
  "latestVersion": "v1.1.0"
}
```

Если релизов нет:
```json
{
  "sourceType": "git",
  "updateType": "branch",
  "warning": "No releases found. Updates will use main/master branch (may be unstable)"
}
```

#### Обновление:
```bash
POST /bots/:id/update
# или специфичный для git:
POST /bots/:id/git/upgrade
```

**Важно**: Если релизов нет, система покажет предупреждение, что будет использована main ветка.

---

### 2. ZIP Source (Архив)

**Подходит для**: одноразовых деплоев, быстрого тестирования

#### Как работает:
- При создании бота распаковывается ZIP архив
- Для обновления нужно загрузить новый ZIP файл

#### Проверка обновлений:
```bash
GET /bots/:id/update/status
```

Ответ:
```json
{
  "sourceType": "zip",
  "canUpdate": true,
  "message": "ZIP bots can be updated by providing a new ZIP file path",
  "sourcePath": "/path/to/original.zip"
}
```

#### Обновление:
```bash
POST /bots/:id/update
Content-Type: application/json

{
  "source": "/path/to/new-bot.zip"
}
```

**Важно**: Нужно указать путь к новому ZIP файлу.

---

### 3. Local Source (Локальный путь)

**Подходит для**: разработки, локального тестирования

#### Как работает:
- При создании бота копируется содержимое из локальной директории
- При обновлении пересобирается из того же локального пути

#### Проверка обновлений:
```bash
GET /bots/:id/update/status
```

Ответ:
```json
{
  "sourceType": "local",
  "canUpdate": true,
  "message": "Local bots can be updated by rebuilding from the source path",
  "sourcePath": "/path/to/bot-project"
}
```

#### Обновление:
```bash
POST /bots/:id/update
```

Система автоматически пересоберет бота из сохраненного локального пути.

---

## Примеры использования

### Создание бота с Git (с релизами)

```bash
POST /bots
Content-Type: application/json

{
  "name": "My Production Bot",
  "runtime": "swarm",
  "sourceType": "git",
  "source": "https://github.com/user/my-bot.git",
  "botToken": "1234567890:ABC...",
  "env": {
    "ADMIN_ID": "123456789"
  }
}
```

Система автоматически:
1. Склонирует репозиторий
2. Найдет последний release tag (например, `v1.0.0`)
3. Переключится на эту версию
4. Соберет и запустит бота

### Обновление бота

```bash
# Проверить наличие обновлений
GET /bots/:id/update/status

# Если updateAvailable: true, обновить:
POST /bots/:id/update
```

### С потоковым логированием

```bash
POST /bots/:id/update?stream=true
```

Вы получите в реальном времени логи сборки и деплоя.

---

## Best Practices

### Для Production

1. **Используйте Git с релизами**
   - Создавайте теги версий: `v1.0.0`, `v1.1.0` и т.д.
   - Следуйте [Semantic Versioning](https://semver.org/)

2. **Не используйте main ветку для production**
   - Система покажет предупреждение, если релизов нет
   - Main ветка может содержать нестабильный код

3. **Тестируйте перед релизом**
   - Используйте локальный source для тестирования
   - Создайте release только после проверки

### Для разработки

1. **Используйте Local Source**
   ```bash
   {
     "sourceType": "local",
     "source": "./packages/my-bot"
   }
   ```

2. **Быстрое обновление**
   ```bash
   POST /bots/:id/update
   ```
   Изменения применятся мгновенно.

### Рабочий процесс с релизами

```bash
# 1. Разработка локально
git clone https://github.com/user/bot.git
cd bot
# ... внести изменения ...

# 2. Протестировать локально
curl -X POST http://localhost:3000/bots \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Bot",
    "sourceType": "local",
    "source": "./bot"
  }'

# 3. Создать релиз
git tag v1.1.0
git push origin v1.1.0

# 4. Обновить production бота
curl -X POST http://localhost:3000/bots/:id/update
```

---

## API Reference

### Проверка статуса обновления
- **Endpoint**: `GET /bots/:id/update/status`
- **Auth**: Required
- **Response**: Зависит от типа источника (см. выше)

### Обновление бота (универсальное)
- **Endpoint**: `POST /bots/:id/update`
- **Auth**: Required
- **Query params**:
  - `stream=true` - потоковое логирование
- **Body** (для ZIP):
  ```json
  {
    "source": "/path/to/new.zip"
  }
  ```
- **Response**: Обновленный объект бота

### Git-специфичное обновление
- **Endpoint**: `POST /bots/:id/git/upgrade`
- **Auth**: Required
- **Response**: Обновленный объект бота

---

## Troubleshooting

### "No releases found" warning

**Проблема**: Бот создан из git, но релизов нет.

**Решение**:
1. Создайте release tag в репозитории:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. Пересоздайте бота или используйте с осторожностью main ветку.

### Обновление не применяется

**Проблема**: После обновления изменения не видны.

**Проверьте**:
1. Версия действительно изменилась:
   ```bash
   GET /bots/:id/update/status
   ```

2. Бот перезапустился:
   ```bash
   GET /bots/:id
   # Проверить status: "running"
   ```

3. Логи бота:
   ```bash
   GET /bots/:id/logs?tail=100
   ```

### ZIP обновление не работает

**Проблема**: `"ZIP source not found"`

**Решение**:
- Убедитесь, что путь к ZIP файлу доступен из контейнера bot-manager
- Используйте абсолютные пути или положите ZIP в примонтированный volume

---

## Migration Guide

### С main ветки на релизы

Если у вас уже есть боты, использующие main ветку:

1. Создайте первый релиз в репозитории:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. Обновите бота:
   ```bash
   POST /bots/:id/update
   ```

3. Проверьте версию:
   ```bash
   GET /bots/:id
   ```

   В ответе должно быть:
   ```json
   {
     "gitVersion": "v1.0.0"
   }
   ```

Теперь ваш бот будет отслеживать релизы, а не main ветку.
