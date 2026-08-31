# CLAUDE.md — Anytype Agent Developer Guide

Anytype Agent is an autonomous, reactive NestJS service running on **Bun** that connects Anytype spaces to AI agents (such as Google Antigravity `agy` or Anthropic `claude` CLI via SSH).

---

## 🛠️ Tech Stack & Tooling

- **Runtime**: [Bun](https://bun.com) (`v1.2+`)
- **Framework**: [NestJS 11](https://nestjs.com) (Standalone Application Context)
- **Reactive Streams**: [RxJS 7](https://rxjs.dev) (All async domain workflows & SSE streams)
- **Schema Validation & Typing**: [TypeBox](https://github.com/sinclairzx81/typebox) (Runtime contract validation & discriminated unions)
- **Linter & Formatter**: [Biome](https://biomejs.dev) (`@biomejs/biome`)
- **Testing**: `bun:test` & `@nestjs/testing`

---

## 🚀 Common Commands

```bash
# Install dependencies
bun install

# Run in development mode (hot-reload)
bun dev

# Run in production mode
bun start

# Run all tests
bun test

# Run a specific test file
bun test src/observer/__tests__/chat.observer.test.ts

# Lint and format code with Biome
npm run check       # Runs biome check --write .
npm run lint        # Runs biome lint .
npm run format      # Runs biome format --write .
```

---

## 🏗️ Architecture & Core Modules

```
src/
├── app.config.ts          # TypeBox configuration schema (HostConfig vs ApiConfig)
├── app.module.ts          # Root NestJS module importing Client, Observer, LLM
├── index.ts               # Application bootstrap entry point
├── client/                # Anytype API Client & Proxy
│   ├── anytype.client.ts  # Low-level HTTP transport, headers, auth & SSE streaming
│   ├── anytype.service.ts # High-level Domain API facade (spaces, chats, members, objects)
│   ├── anytype.proxy.ts   # Dynamic 6-digit space alias proxy (Bun.serve) & telemetry traces
│   ├── routes.ts          # Anytype API endpoint catalog for LLM prompt
│   └── types/             # Domain & raw SSE event schemas (TypeBox)
├── llm/                   # LLM & Host Agent Integration
│   ├── host.model.ts      # SSH-based remote CLI invoker (agy / claude) with telemetry
│   ├── prompts/           # System prompt templates
│   └── types.ts           # AbstractLlmService, LlmAction (ACT), LlmResponse (RES)
└── observer/              # Reactive Space & Chat Observation
    ├── chat.observer.ts   # Chat SSE observer (debounce, anti-echo, canary, progress editing)
    ├── observer.service.ts# Space scanner, permissions verifier, registry & lifecycle manager
    └── types.ts           # Observer interfaces & factory contracts
```

---

## 🔑 Key Architectural Invariants

### 1. Separation of Concerns & Boundary Invariants
- `AnytypeClient` is strictly a low-level HTTP & SSE transport layer. It knows nothing about domain logic.
- `AnytypeService` encapsulates all Anytype domain interactions.
- `AnytypeProxy` provides a secure loopback proxy (`127.0.0.1:31013`) that issues ephemeral 6-digit aliases (`/v1/spaces/123456/...`) for the active space, preventing exposure of real space IDs to the LLM agent.

### 2. Reactive Observables & Lifecycle Management
- All streams must be properly guarded with `takeUntil(this.destroy$)` or `takeUntil(done$)`.
- Clean teardown: alias revocation and stream cancellations happen inside RxJS `finalize()` blocks.
- Chat triggers use `exhaustMap()`: concurrent message triggers during an ongoing LLM generation are dropped rather than queued, avoiding thrashing.
- Fault tolerance: network errors during progress updates or LLM executions are silenced or caught gracefully using `safe$()` / `retry()`, keeping the primary SSE stream active.

### 3. Participant Wire Identity & Anti-Echo
- Anytype wire participant ID format: `_participant_<spaceId>_<identity>` (where `spaceId` has dots replaced by underscores, and `identity` has no underscores).
- Matching must always use suffix comparison (`endsWith(`_${botMemberId}`)`).
- Edits, deletions, bot self-messages, and reactions are filtered out before reaching the LLM pipeline.

### 4. Configuration & Validation
- Environment variables are strictly validated on bootstrap via TypeBox discriminated unions in `app.config.ts`.
- `LLM_MODE=host` requires `HOST_SSH_USER`, `HOST_SSH_KEY_PATH`, and `HOST_CLI_BIN`.
- `LLM_MODE=api` requires `OPENAI_API_KEY`.

---

## 🧪 Testing Guidelines

- Write unit and integration tests under `__tests__/` directories next to their modules.
- Use `bun:test` syntax (`describe`, `it`, `expect`, `mock`, `spyOn`).
- Test async RxJS streams using helper utilities (`waitFor`, `sleep`, `makeMessage`) in `src/observer/__tests__/helpers.ts`.
- Mock external network calls (`globalThis.fetch` or `AbstractLlmService`) to maintain deterministic, fast tests.
