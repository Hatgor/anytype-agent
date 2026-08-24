import "reflect-metadata";
import { beforeAll, describe, expect, it } from "bun:test";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { validateConfig } from "../app.config";

describe("AppModule & Standalone Bootstrap", () => {
  beforeAll(() => {
    process.env.ANYTYPE_API_URL = "http://127.0.0.1:31012";
    process.env.ANYTYPE_BOT_NAME = "NestBot";
    process.env.ANYTYPE_API_KEY = "nest_key_999";
  });

  it("validates AppConfig schema via validateConfig", () => {
    const valid = {
      ANYTYPE_API_URL: "http://127.0.0.1:31012",
      ANYTYPE_BOT_NAME: "DevBot",
      ANYTYPE_API_KEY: "secret_token",
    };
    const parsed = validateConfig(valid);
    expect(parsed.ANYTYPE_BOT_NAME).toBe("DevBot");
    expect(parsed.ANYTYPE_API_URL).toBe("http://127.0.0.1:31012");
  });

  it("throws clear error if environment variables are missing", () => {
    expect(() => validateConfig({})).toThrow("Invalid environment variables");
  });

  it("bootstraps Standalone ApplicationContext and injects ConfigService", async () => {
    const { AppModule } = await import("../app.module");
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });

    const configService = app.get(ConfigService);
    expect(configService.get<string>("ANYTYPE_BOT_NAME")).toBe("NestBot");
    expect(configService.get<string>("ANYTYPE_API_URL")).toBe("http://127.0.0.1:31012");

    await app.close();
  });
});
