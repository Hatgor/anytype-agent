import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { AppConfig } from "../app.config";
import { ClientModule } from "../client";
import { HostModelService } from "./host.model";
import { ProxyService } from "./proxy.service";
import { AbstractLlmService } from "./types";

export const LLM_SERVICE = Symbol.for("LLM_SERVICE");

@Module({
  imports: [ConfigModule, ClientModule],
  providers: [
    // TODO: Прокси имеет смысл только если мы в HOST режиме
    // Значит нет смысла регать его ВСЕГДА. Но это требует DynamicModule кажись
    ProxyService,
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
        // TODO: придумать как подружить ConfigService с Union типами
        // const isOpenAi = Boolean(config.get("OPENAI_API_KEY" as keyof AppConfig));
        const service: AbstractLlmService = hostModel;

        // Async healthcheck during module construction / DI bootstrap
        await service.init();
        return service;
      },
    },
  ],
  exports: [LLM_SERVICE, ProxyService],
})
export class LlmModule {}
