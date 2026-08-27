# syntax=docker/dockerfile:1
FROM oven/bun:latest

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# SSH-клиент для вызова хостового агента (agy / claude)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./

RUN bun install

COPY ./src /app/src

CMD ["bun", "dev"]
