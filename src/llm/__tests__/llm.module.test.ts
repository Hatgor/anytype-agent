import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { AnytypeClient } from "../../client/anytype.client";
import { ANYTYPE_CLIENT } from "../../client/client.constants";
import { LlmModule } from "../llm.module";
import { LlmService } from "../llm.service";

describe("LlmModule (DynamicModule & CLI Mode)", () => {
  const fakeClient = {
    get: mock(async () => ({})),
    post: mock(async () => ({})),
    patch: mock(async () => ({})),
    delete: mock(async () => ({})),
    stream: mock(() => ({ pipe: () => ({}) })),
  } as unknown as AnytypeClient;

  it("resolves LlmService when registering cli mode", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              LLM_MODE: "cli",
              ANYTYPE_API_URL: "http://localhost:31012",
              ANYTYPE_BOT_NAME: "Bot",
              ANYTYPE_API_KEY: "token",
              HOST_CLI_BIN: "agy",
              HOST_SSH_USER: "test",
              HOST_SSH_KEY_PATH: "/dev/null",
            }),
          ],
        }),
        LlmModule.register("cli"),
      ],
    })
      .overrideProvider(ANYTYPE_CLIENT)
      .useValue(fakeClient)
      .compile();

    const llm = moduleRef.get(LlmService);
    expect(llm).toBeInstanceOf(LlmService);
  });

  it("throws error for unsupported mode", () => {
    expect(() => LlmModule.register("unknown" as never)).toThrow("Unsupported LLM mode: unknown");
  });
});
