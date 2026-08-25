import { Module } from "@nestjs/common";
import { ClientModule } from "../client";
import { ChatObserverFactory } from "./chat.observer";
import { OBSERVERS } from "./constants";
import { ObserverService } from "./observer.service";

@Module({
  imports: [ClientModule],
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
