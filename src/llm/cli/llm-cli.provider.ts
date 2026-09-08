import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ModelMessage } from "ai";
import { defer, finalize, Observable } from "rxjs";
import type { HostConfig } from "../../app.config";
import { AbstractLlmProvider } from "../types";
import { AnytypeProxy } from "./anytype.proxy";
import { AbstractLlmCli, buildSystemMessage } from "./providers";

@Injectable()
export class LlmCliProvider extends AbstractLlmProvider {
  constructor(
    private readonly config: ConfigService<HostConfig, true>,
    private readonly proxy: AnytypeProxy,
    private readonly cli: AbstractLlmCli,
  ) {
    super();
  }

  run(spaceId: string, history: ModelMessage[]): Observable<ModelMessage> {
    return defer(() => {
      const alias = this.proxy.issueSpaceAlias(spaceId);

      const systemMessage = buildSystemMessage(
        this.config.get("ANYTYPE_BOT_NAME"),
        `http://127.0.0.1:${this.config.get("HOST_PROXY_PORT")}`,
        this.proxy.routesDoc,
        alias,
      );

      const all = [systemMessage, ...history];

      return this.cli.exec(all).pipe(finalize(() => this.proxy.revokeSpaceAlias(alias)));
    });
  }
}
