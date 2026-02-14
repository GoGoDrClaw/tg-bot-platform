FROM node:18-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/bot-manager/package*.json packages/bot-manager/
COPY packages/runtime-adapters/package*.json packages/runtime-adapters/

RUN npm install --workspaces

COPY tsconfig*.json ./
COPY packages packages

RUN npm --workspace @bot-platform/runtime-adapters run build && \
    npm --workspace @bot-platform/bot-manager run build && \
    npm prune --omit=dev --workspaces

ENV API_PORT=3000
ENV API_HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/bot-manager/dist/server.js"]
