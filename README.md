# Anytype Agent 🤖✨

Autonomous, reactive AI bridge connecting [Anytype](https://anytype.io) spaces and chats to local or remote AI agents.

Built with **Bun**, **NestJS 11**, **RxJS**, and **TypeBox**.

---

## 🚧 Work in Progress & Status

> [!IMPORTANT]
> **Current Support Status**: At this stage, the project actively supports **ONLY `LLM_MODE=host`** using **`agy`** ([Google Antigravity CLI](https://antigravity.google)). All other modes and CLI adapters are currently **Planned / WIP**.

| Feature / Adapter | Status | Description |
| :--- | :---: | :--- |
| **Host Mode: `agy` CLI** | ✅ **Supported** | Primary supported runner via SSH (`HOST_CLI_BIN=agy`) with dynamic proxy & telemetry |
| **Host Mode: `claude` CLI** | ⏳ *Planned* | Anthropic CLI adapter (flag and output parser customization) |
| **API Mode: BYOK / OpenAI** | ⏳ *Planned* | Direct API integration (`LLM_MODE=api` for OpenAI-compatible endpoints) |
| **Reactive Chat Observer** | ✅ **Supported** | Real-time SSE streaming, debounce, anti-echo, backfill deduplication, canary progress |
| **Dynamic Space Proxy** | ✅ **Supported** | Ephemeral 6-digit space ID aliasing & real-time telemetry streaming |
| **Object Mention Polling** | ⏳ *Planned* | Background space polling for object mentions and document updates |

---

## ✨ Features

- **⚡ Reactive Chat Observer**: Real-time SSE streaming for chat messages with intelligent debouncing, backfill deduplication, and anti-echo protection.
- **🔒 Ephemeral Space Isolation (Proxy)**: Dynamic reverse proxy with 6-digit aliasing that protects actual Anytype space IDs and routes tool calls securely during LLM execution.
- **📡 Real-Time Progress Streaming**: Posts immediate italicized status messages (`⏳ Working...`) and streams tool telemetry steps as the agent executes actions.
- **🤖 Remote Host Execution**: Headless execution of host CLI agents (`agy`) through secure SSH tunneling with STDIN prompt delivery.
- **🛡️ Resilient Recovery & Canary Healthchecks**: Automatic reconnection on SSE dropouts, fail-fast configuration verification on bootstrap, and non-blocking background space discovery.

---

## 🏗️ Architecture

```
                      ┌─────────────────────────────────────────┐
                      │              Anytype Daemon             │
                      │       (HTTP REST & SSE Events)          │
                      └────────────────────┬────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │                                     │
                        ▼                                     ▲
             ┌─────────────────────┐               ┌─────────────────────┐
             │    AnytypeClient    │               │    AnytypeProxy     │
             │   (Transport/SSE)   │               │ (Ephemeral Aliasing)│
             └──────────┬──────────┘               └──────────▲──────────┘
                        │                                     │
                        ▼                                     │
             ┌─────────────────────┐                          │
             │   ObserverService   │                          │
             │   & ChatObserver    │                          │
             └──────────┬──────────┘                          │
                        │                                     │
                        ▼                                     │
             ┌─────────────────────┐                          │
             │   HostModelService  ├──────────────────────────┘
             │   (SSH -> agy CLI)  │
             └─────────────────────┘
```

---

## 📋 Prerequisites

- [Bun](https://bun.com) (`v1.2+`) or [Docker](https://www.docker.com/) & Docker Compose
- Anytype node / daemon with API enabled (e.g. `ghcr.io/anyproto/anytype-cli:latest` or Anytype desktop with API active)
- SSH access to the host machine with `agy` installed and available in `$PATH`

---

## ⚙️ Configuration

Configure the agent using environment variables or a `.env` file:

### Core Anytype Settings

| Variable | Description | Default |
| :--- | :--- | :--- |
| `ANYTYPE_API_URL` | Base URL of the Anytype API (e.g., `http://127.0.0.1:31012`) | *Required* |
| `ANYTYPE_BOT_NAME` | Identity name of the bot user in Anytype spaces | *Required* |
| `ANYTYPE_API_KEY` | Anytype API authentication token | *Required* |
| `OBSERVER_DEBOUNCE_MS` | Debounce delay for chat message bursts | `800` |
| `OBSERVER_RETRY_DELAY_MS` | Reconnect retry interval for SSE streams | `3000` |
| `OBSERVER_SCAN_INTERVAL_MS` | Interval for discovering new/updated spaces | `60000` |

### Mode: Host Agent via SSH (`LLM_MODE=host` — Supported)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LLM_MODE` | Must be set to `host` | `host` |
| `HOST_CLI_BIN` | Binary name of the host CLI agent (currently `agy`) | `agy` |
| `HOST_SSH_USER` | SSH username on the host machine | *Required* |
| `HOST_SSH_KEY_PATH` | Path to private SSH key | *Required* |
| `HOST_SSH_HOST` | Host address reachable from the agent container | `host.docker.internal` |
| `HOST_PROXY_PORT` | Port for the local Anytype proxy | `31013` |

### Mode: Direct API (`LLM_MODE=api` — Planned / WIP)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LLM_MODE` | Set to `api` *(Planned)* | — |
| `OPENAI_API_KEY` | API Key for OpenAI-compatible endpoint | *Required (when api mode is active)* |
| `OPENAI_BASE_URL` | Custom base URL for the API provider | Optional |
| `OPENAI_MODEL` | Target model name | Optional |

---

## 🚀 Quick Start

### Running with Bun Locally

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Setup environment**:
   ```bash
   cp .env.example .env # configure ANYTYPE_* and HOST_* variables
   ```

3. **Start in development mode**:
   ```bash
   bun dev
   ```

### Running with Docker Compose

```bash
docker compose up --build
```

---

## 🧪 Development & Testing

```bash
# Run unit & integration tests
bun test

# Run tests in watch mode
bun test --watch

# Check formatting & linting with Biome
npm run check

# Format codebase
npm run format
```

---

## 📄 License

MIT
