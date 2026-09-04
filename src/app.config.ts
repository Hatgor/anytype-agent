import { type Static, Type } from "typebox";
import { Settings } from "typebox/system";
import Value from "typebox/value";

Settings.Set({ correctiveParse: true });

// Common required fields for any mode
export const BaseConfig = Type.Object({
  ANYTYPE_API_URL: Type.String({ minLength: 1 }),
  ANYTYPE_BOT_NAME: Type.String({ minLength: 1 }),
  ANYTYPE_API_KEY: Type.String({ minLength: 1 }),
  OBSERVER_DEBOUNCE_MS: Type.Number({ default: 800 }),
  OBSERVER_RETRY_DELAY_MS: Type.Number({ default: 3000 }),
  OBSERVER_SCAN_INTERVAL_MS: Type.Number({ default: 60000 }),
  // Revolver pool size: max simultaneously observed chats per space (SSE connections are not free).
  OBSERVER_MAX_ACTIVE_CHATS: Type.Number({ default: 50 }),
});
export type BaseConfig = Static<typeof BaseConfig>;

// Config #1: Host (SSH / CLI) mode
export const HostConfig = Type.Intersect([
  BaseConfig,
  Type.Object({
    LLM_MODE: Type.Literal("host"),
    HOST_SSH_USER: Type.String({ minLength: 1 }),
    HOST_SSH_KEY_PATH: Type.String({ minLength: 1 }),
    HOST_CLI_BIN: Type.String({ minLength: 1 }),
    HOST_SSH_HOST: Type.String({ default: "host.docker.internal" }),
    HOST_PROXY_PORT: Type.Number({ default: 31013 }),
  }),
]);
export type HostConfig = Static<typeof HostConfig>;

// Config #2: API (BYOK / OpenAI) mode
export const ApiConfig = Type.Intersect([
  BaseConfig,
  Type.Object({
    LLM_MODE: Type.Literal("api"),
    OPENAI_API_KEY: Type.String({ minLength: 1 }),
    OPENAI_BASE_URL: Type.Optional(Type.String()),
    OPENAI_MODEL: Type.Optional(Type.String()),
  }),
]);
export type ApiConfig = Static<typeof ApiConfig>;

// Final discriminated union
export const AppConfig = Type.Union([HostConfig, ApiConfig]);
export type AppConfig = Static<typeof AppConfig>;

export function validateConfig(config: Record<string, unknown>): AppConfig {
  for (const schema of AppConfig.anyOf) {
    // biome-ignore format: compact try-catch
    try { return Value.Parse(schema, Value.Default(schema, config)) }
    catch {}
  }

  // If no schema branch matched, collect proper validation errors
  const errors = [...Value.Errors(AppConfig, config)]
    .map((e) => `  - ${e.instancePath || "/"}: ${e.message}`)
    .join("\n");
  throw new Error(`[ConfigModule] Invalid environment variables:\n${errors}`);
}
