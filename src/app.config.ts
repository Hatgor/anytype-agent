import { type Static, Type } from "typebox";
import { Settings } from "typebox/system";
import Value from "typebox/value";

Settings.Set({ correctiveParse: true });

// Общие обязательные поля для любого режима
export const BaseConfig = Type.Object({
  ANYTYPE_API_URL: Type.String({ minLength: 1 }),
  ANYTYPE_BOT_NAME: Type.String({ minLength: 1 }),
  ANYTYPE_API_KEY: Type.String({ minLength: 1 }),
  OBSERVER_DEBOUNCE_MS: Type.Number({ default: 800 }),
  OBSERVER_RETRY_DELAY_MS: Type.Number({ default: 3000 }),
  OBSERVER_SCAN_INTERVAL_MS: Type.Number({ default: 60000 }),
});
export type BaseConfig = Static<typeof BaseConfig>;

// Конфиг №1: Host (SSH / CLI) Режим
export const HostConfig = Type.Intersect([
  BaseConfig,
  Type.Object({
    LLM_MODE: Type.Literal("host"),
    HOST_SSH_USER: Type.String({ minLength: 1 }),
    HOST_SSH_KEY_PATH: Type.String({ minLength: 1 }),
    HOST_CLI_BIN: Type.String({ minLength: 1 }),
    HOST_SSH_HOST: Type.String({ default: "host.docker.internal" }),
  }),
]);
export type HostConfig = Static<typeof HostConfig>;

// Конфиг №2: API (BYOK / OpenAI) Режим
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

// Итоговый Discriminated Union
export const AppConfig = Type.Union([HostConfig, ApiConfig]);
export type AppConfig = Static<typeof AppConfig>;

export function validateConfig(config: Record<string, unknown>): AppConfig {
  for (const schema of AppConfig.anyOf) {
    // biome-ignore format: compact try-catch
    try { return Value.Parse(schema, Value.Default(schema, config)) }
    catch {}
  }

  // Если ни одна ветка не подошла — собираем честные ошибки валидации
  const errors = [...Value.Errors(AppConfig, config)]
    .map((e) => `  - ${e.instancePath || "/"}: ${e.message}`)
    .join("\n");
  throw new Error(`[ConfigModule] Invalid environment variables:\n${errors}`);
}
