# Repository Guidelines

## Project Structure & Modules
- Monorepo under `packages/`: `bot-manager` (API + lifecycle), `runtime-adapters` (Docker/Swarm/K8s adapters), `sample-bot` (grammY setup function), `web-ui` (static UI). Templates for runtime/Dockerfile live in `packages/bot-manager/templates`.
- Config: `docker-compose.yml`, `docker-stack.yml`, `Caddyfile`, `.env.example`.
- Storage: runtime workdir and SQLite under `storage/`.

## Build, Test, Dev Commands
- Install deps: `npm install --workspaces`.
- Build adapters: `npm --workspace @bot-platform/runtime-adapters run build`.
- Build bot-manager: `npm --workspace @bot-platform/bot-manager run build`.
- Dev API: `npm run dev:api` (honors `API_HOST`/`API_PORT`, serves UI static).
- Sample bot: `npm --workspace @bot-platform/sample-bot run build` (setup function only; runtime builds bots).
- Docker dev stack: `cp .env.example .env && docker compose up --build`.

## Coding Style & Naming
- Language: TypeScript (Node 18 target). Strict mode on. Decorators enabled for TypeORM.
- Imports: prefer alias `@/...` within bot-manager, `@bot-platform/runtime-adapters` for adapters.
- Indentation: 2 spaces; keep functions small and typed.
- Runtime bots: export a setup function `(bot: Bot) => void`; do not start servers in bot code.
 - Runtime port is fixed (default `8080`) for all bots; Caddy proxies `/w/<bot_id>` to `bot-<id>:8080` on the Docker network.

## Testing Guidelines
- No formal test suite yet; add targeted unit/integration tests alongside code when contributing (`__tests__` or `*.spec.ts`).
- Validate flows manually: create bot (local/git/zip), build/deploy, webhook health.

## Commit & PR Guidelines
- Commits: concise, imperative, grouped by concern (e.g., “Add runtime webhook setup”). Avoid unrelated changes.
- PRs: include summary of changes, testing done (commands), and any env/DB/migration notes. Attach screenshots for UI tweaks.

## Security & Configuration
- Use `.env` (copy from `.env.example`) to set DB and Telegram API params; avoid committing secrets.
- Local Bot API available via `bot-api` service; set `TELEGRAM_API_BASE=http://bot-api:8081`. Webhook base defaults to `http://bot-manager:3000/w`.
- Containers: json-file logging capped (10m x3). Bot containers run non-privileged; keep resource limits when adding runtimes.
