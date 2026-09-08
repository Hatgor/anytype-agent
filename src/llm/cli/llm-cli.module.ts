import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { HostConfig } from "../../app.config";
import { ClientModule } from "../../client";
import { AbstractLlmProvider } from "../types";
import { AnytypeProxy } from "./anytype.proxy";
import { LlmCliProvider } from "./llm-cli.provider";
import { AbstractLlmCli } from "./providers";
import { AgyCliProvider } from "./providers/agy-cli.provider";

@Module({
  imports: [ClientModule],
  providers: [
    AnytypeProxy.forRoot(),
    {
      provide: AbstractLlmCli,
      inject: [ConfigService],
      useFactory: (config: ConfigService<HostConfig, true>) => {
        // Here we are gonna to determine WHICH of all AbstractLlmCli cases we are gonna use (in future)
        return new AgyCliProvider(config);
      },
    },
    {
      provide: AbstractLlmProvider,
      useClass: LlmCliProvider,
    },
  ],
  exports: [AbstractLlmProvider],
})
export class LlmCliModule {}
