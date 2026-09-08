import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AnytypeClient } from "./anytype.client";
import { AnytypeProxy } from "./anytype.proxy";
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
    AnytypeProxy,
  ],
  exports: [ANYTYPE_CLIENT, AnytypeService, AnytypeProxy],
})
export class ClientModule {}
