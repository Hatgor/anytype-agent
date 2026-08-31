# syntax=docker/dockerfile:1

# 1. base: common system dependencies for SSH client (invoking agy)
FROM oven/bun:1-debian AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 2. dev: target for local development via docker compose (all dependencies + hot reload watcher)
FROM base AS dev
ENV NODE_ENV=development
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY ./src ./src
CMD ["bun", "run", "dev"]

# 3. prod-deps: production dependencies only (without devDeps)
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts

# 4. prod: minimal production runtime image for GHCR (native TS execution via Bun, no bundler)
FROM base AS prod
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY ./src ./src
CMD ["bun", "run", "start"]
