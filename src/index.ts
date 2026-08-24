import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  console.log("🌟 [AnytypeAgent] Bootstrapping NestJS Standalone Application...");
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  console.log("✅ [AnytypeAgent] Application context initialized successfully");
}

bootstrap().catch((err: unknown) => {
  console.error("💥 [AnytypeAgent] Fatal bootstrap error:", err);
  process.exit(1);
});
