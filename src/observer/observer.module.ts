import { Module } from "@nestjs/common";
import { ClientModule } from "../client";
import { LlmModule } from "../llm/llm.module";
import { ChatObserverFactory } from "./chat.observer";
import { OBSERVERS } from "./constants";
import { ObserverService } from "./observer.service";

@Module({
  imports: [ClientModule, LlmModule],
  providers: [
    ChatObserverFactory,
    {
      provide: OBSERVERS,
      inject: [ChatObserverFactory],
      useFactory: (chatFactory) => [chatFactory],
    },
    ObserverService,
  ],
  exports: [ObserverService],
})
export class ObserverModule {}
