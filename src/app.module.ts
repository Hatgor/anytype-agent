import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClsModule } from "nestjs-cls";
import { validateConfig } from "./app.config";
import { ClientModule } from "./client";

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
  ],
})
export class AppModule {}
