
import Value from "typebox/value";
import { AppConfig } from "./schema";

export function getAppConfig(): AppConfig {
  return Value.Parse(AppConfig, process.env);
}
