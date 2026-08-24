import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ClsModule } from "nestjs-cls";
import { validateConfig } from "./app.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
    ClsModule.forRoot({
      global: true,
    }),
  ],
})
export class AppModule {}
