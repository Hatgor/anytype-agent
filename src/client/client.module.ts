import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AnytypeClient } from "./anytype.client";
import { AnytypeService } from "./anytype.service";
import { ANYTYPE_CLIENT } from "./client.constants";

@Module({
  providers: [
    {
      provide: ANYTYPE_CLIENT,
      inject: [ConfigService],
      useFactory: AnytypeClient.factory,
    },
    AnytypeService,
  ],
  exports: [ANYTYPE_CLIENT, AnytypeService],
})
export class ClientModule {}
