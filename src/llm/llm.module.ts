import { type DynamicModule, Module } from "@nestjs/common";
import { LlmCliModule } from "./cli/llm-cli.module";
import { LlmService } from "./llm.service";

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module pattern
export class LlmModule {
  static register(mode = process.env.LLM_MODE): DynamicModule {
    if (mode !== "cli") throw new Error(`Unsupported LLM mode: ${mode}`);

    return {
      global: true,
      module: LlmModule,
      imports: [LlmCliModule],
      providers: [LlmService],
      exports: [LlmService],
    };
  }
}
