import { type Static, Type } from "typebox";
import Value from "typebox/value";

export const AppConfig = Type.Object({
  ANYTYPE_API_URL: Type.String({ minLength: 1 }),
  ANYTYPE_BOT_NAME: Type.String({ minLength: 1 }),
  ANYTYPE_API_KEY: Type.String({ minLength: 1 }),
});
export type AppConfig = Static<typeof AppConfig>;

export function validateConfig(config: Record<string, unknown>): AppConfig {
  try {
    return Value.Parse(AppConfig, config);
  } catch (_err: unknown) {
    const errors = [...Value.Errors(AppConfig, config)]
      .map((e) => `  - ${e.instancePath || "/"}: ${e.message}`)
      .join("\n");
    throw new Error(`[ConfigModule] Invalid environment variables:\n${errors}`);
  }
}
