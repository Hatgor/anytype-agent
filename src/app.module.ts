import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClsModule } from "nestjs-cls";
import { validateConfig } from "./app.config";
import { ClientModule } from "./client";
import { ObserverModule } from "./observer/observer.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
    ClsModule.forRoot({
      global: true,
    }),
    ClientModule,
    ObserverModule,
  ],
})
export class AppModule {}
