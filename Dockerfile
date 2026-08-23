# syntax=docker/dockerfile:1
FROM oven/bun:latest

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

WORKDIR /app
COPY package.json bun.lock tsconfig.json ./

RUN bun install

COPY ./src /app/src

CMD ["bun", "start"]
