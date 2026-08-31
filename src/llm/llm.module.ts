import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { AppConfig } from "../app.config";
import { ClientModule } from "../client";
import { HostModelService } from "./host.model";
import { AbstractLlmService } from "./types";

export const LLM_SERVICE = Symbol.for("LLM_SERVICE");

@Module({
  imports: [ConfigModule, ClientModule],
  providers: [
    HostModelService,
    // ApiModelService,
    {
      provide: LLM_SERVICE,
      inject: [
        ConfigService,
        HostModelService,
        // ApiModelService
      ],
      useFactory: async (
        config: ConfigService<AppConfig, true>,
        hostModel: HostModelService,
        // apiModel: ApiModelService,
      ): Promise<AbstractLlmService> => {
        // TODO: figure out how to make ConfigService work smoothly with Union types
        // const isOpenAi = Boolean(config.get("OPENAI_API_KEY" as keyof AppConfig));
        const service: AbstractLlmService = hostModel;

        // init() inside DI factory: invalid config/SSH fails immediately during module bootstrap
        await service.init();
        return service;
      },
    },
  ],
  exports: [LLM_SERVICE],
})
export class LlmModule {}
