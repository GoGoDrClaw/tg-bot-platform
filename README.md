# Bot Platform (Telegram PaaS)

Self-hosted PaaS for fast deploy and validation of Telegram bots. Stack: TypeScript, Node.js, TypeORM, Docker Swarm or Kubernetes, Caddy for HTTPS/webhook routing.

## Architecture
- **Bot Manager API (TypeScript, Express + TypeORM)** – lifecycle, validation, image build, runtime orchestration, webhook setup.
- **Runtime Layer** – pluggable `RuntimeAdapter` (Docker container, Swarm service per bot, or K8s deployment+service).
- **Reverse Proxy** – Caddy terminates TLS and routes `/w/<bot_id>` to bot services.
- **DB** – TypeORM entities; SQLite for dev, Postgres for prod.
- **Web UI** – minimal static page calling API.
- **Sample bot** – reference bot with `handleUpdate` + `bot.json` manifest (platform builds image).

## Monorepo layout
- `packages/bot-manager` – API server, validation, lifecycle.
- `packages/runtime-adapters` – `RuntimeAdapter` interface, Docker adapter, Swarm adapter, Kubernetes skeleton.
- `packages/sample-bot` – minimal webhook bot fulfilling contract and manifest example.
- `packages/web-ui` – static HTML UI hitting API.
- `Caddyfile` – webhook routing.
- Logging: colorized console logger (`LOG_LEVEL` env) + request logs; runtime adapters log deploy/stop actions.
- `docker-compose.yml` – dev stack (bot-manager, Caddy, Postgres, Bot API).
- `docker-stack.yml` – Swarm stack template (with Bot API).

## Running locally (dev)
1) Install deps: `npm install --workspaces` (if offline, ensure required node_modules are present).
2) Build adapters once (for runtime resolution): `npm --workspace @bot-platform/runtime-adapters run build`.
3) Start Bot Manager API (SQLite, port 3000): `npm run dev:api` (env: `API_PORT`, `API_HOST=127.0.0.1` if needed).
4) API base: `http://localhost:3000`.
   - Create bot: `POST /bots` with JSON `{ "name": "demo", "runtime": "swarm", "sourceType": "local", "source": "./packages/sample-bot" }`.
   - Start bot: `POST /bots/:id/start`.
   - Stop bot: `POST /bots/:id/stop`.
   - Logs: `GET /bots/:id/logs`.

## Environment
- Dev DB: SQLite file at `storage/dev.sqlite`.
- Prod: set `DB_URL` for Postgres; see `packages/bot-manager/src/datasource.ts`.
- Telegram: `TELEGRAM_API_BASE` optional override; `BOT_TOKEN` per bot stored as env.
- Docker CLI must be reachable for Swarm adapter; K8s adapter expects `kubectl` context.
- Webhook base defaults to `http://bot-manager:3000/w` (or `WEBHOOK_BASE_URL` if set) so Bot API in Docker can reach it.

## Bot contract (runtime)
- Platform handles HTTP (webhook `/webhook`, `/health`) via shared runtime server inside the container; it sets webhook to platform URL and verifies via `getWebhookInfo`.
- Bot code must export a setup function `(bot: Bot) => void` (default export or named).
- Use full grammY API inside the setup function (`bot.command`, `bot.on`, `bot.api...`).
- Env: `BOT_TOKEN` (required), `PORT` (required, fixed 8080 by default), `BOT_ID` (set by platform), `WEBHOOK_URL` (platform-provided), `TELEGRAM_API_BASE` (optional override to local Bot API).
- Webhook URL pattern: `https://<domain>/w/<bot_id>`.
- Platform builds images with a shared Dockerfile; bots supply code + `bot.json`.

### bot manifest (in package.json)
```json
"bot": {
  "type": "telegram",
  "env": {
    "required": ["BOT_TOKEN"],
    "optional": ["DEBUG"]
  },
  "os-packages": ["ffmpeg=3.12"]
}
```
- Manifest lives in `package.json` (`bot` field). `os-packages` installs apt packages inside the bot container (`pkg=version`).

### Bot code (grammY)
- Export a setup function `(bot: Bot) => void`.
- The platform creates the Bot with correct `apiRoot` (local Bot API) and passes it to your function; register handlers with `bot.command(...)`, `bot.on(...)`, etc.
- No need to launch/poll: runtime-server handles `/webhook` and calls `bot.handleUpdate` after calling `bot.init()`.

## Docker compose / Swarm
- Dev compose: `cp .env.example .env` -> edit as needed -> `docker-compose up --build` (services: bot-manager, caddy, postgres, local bot-api). API on `http://localhost:3000`, Caddy on `http://localhost`, local Bot API on `http://localhost:8081`.
- Swarm stack: `docker stack deploy -c docker-stack.yml bot-platform` (builds bot-manager image, overlay network, includes bot-api on 8081). Env from `.env`.
  - To use local Bot API: set `TELEGRAM_API_BASE=http://bot-api:8081`; supply real `TELEGRAM_API_ID/TELEGRAM_API_HASH` for full functionality.
  - Bot API image: `docker.io/aiogram/telegram-bot-api:latest`.
  - Webhooks: Caddy proxies `/w/<bot_id>` directly to `bot-<id>:8080` inside the Docker network (standardized port).

## Validation steps
1) `package.json` exists and contains keywords `telegram, bot` **or** deps include `telegraf/grammY/aiogram`.
2) `bot.json` exists with `schema=bot/v1`, `type=telegram`, and `env.required` containing `BOT_TOKEN` (optional `os-packages` for apt installs).
3) Build image succeeds (platform Dockerfile, optional `os-packages` installed).
4) Healthcheck: POST `/webhook` with mock update returns `200`.

## Notes
- Default limits applied by adapters (cpu/mem) and no privileged containers.
- Secrets (bot tokens) are never logged. Use `.env` files only for local testing.
