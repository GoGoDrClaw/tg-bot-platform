FROM node:18-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz \
       | tar xzf - --strip-components=1 -C /usr/local/bin docker/docker

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
