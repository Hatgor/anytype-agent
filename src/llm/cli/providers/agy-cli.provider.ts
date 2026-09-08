import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { JSONValue, ModelMessage } from "ai";
import { Observable, type Subscriber } from "rxjs";
import type { HostConfig } from "../../../app.config";
import { AbstractLlmCli } from ".";

interface AgyInitEvent {
  event: "init";
  conversation_id: string;
  init?: {
    cwd?: string;
    tools?: string[];
    permission_mode?: string;
  };
}

interface AgyStepUpdateEvent {
  event: "step_update";
  step_update: {
    conversation_id?: string;
    step_index: number;
    state: "ACTIVE" | "DONE" | "ERROR";
    step_type: "user_input" | "agent_response" | "tool";
    text_delta?: string;
    tool_name?: string;
    tool_info?: {
      name?: string;
      parameters?: Record<string, unknown>;
      output?: unknown;
      error?: { type: string; message: string } | string;
    };
    duration_seconds?: number;
    usage?: Record<string, unknown>;
  };
}

interface AgyResultEvent {
  event: "result";
  result: {
    conversation_id?: string;
    status: "SUCCESS" | "FAILURE";
    response?: string;
    error?: string;
  };
}

type AgyEvent = AgyInitEvent | AgyStepUpdateEvent | AgyResultEvent;

@Injectable()
export class AgyCliProvider extends AbstractLlmCli {
  constructor(private readonly config: ConfigService<HostConfig, true>) {
    super();
  }

  exec(messages: ModelMessage[]): Observable<ModelMessage> {
    return new Observable<ModelMessage>((subscriber) => {
      const cliBin = this.config.get("HOST_CLI_BIN");
      const remoteCommand = `export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"; ${cliBin} -p "$(cat)" --output-format stream-json --dangerously-skip-permissions --disable-slash-commands`;
      const sshArgs = this.buildSshArgs(remoteCommand);
      const stdinText = this.serializeMessagesToPrompt(messages);

      this.logger.log(`🤖 Spawning agy via SSH...`);

      const proc = Bun.spawn(sshArgs, {
        stdin: Buffer.from(stdinText),
        stdout: "pipe",
        stderr: "pipe",
      });

      let killed = false;
      const killProc = () => {
        if (!killed) {
          killed = true;
          try {
            proc.kill("SIGKILL");
          } catch {}
        }
      };

      const stderrChunks: string[] = [];
      const readStderr = async () => {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            stderrChunks.push(decoder.decode(value, { stream: true }));
          }
        } catch {
          // Closed stream or aborted
        } finally {
          reader.releaseLock();
        }
      };
      readStderr();

      const readStdout = async () => {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const parsed = JSON.parse(trimmed) as AgyEvent;
                this.handleAgyEvent(parsed, subscriber);
              } catch {
                this.logger.debug(`[AgyCliProvider] Non-JSON stdout: ${trimmed}`);
              }
            }
          }

          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer.trim()) as AgyEvent;
              this.handleAgyEvent(parsed, subscriber);
            } catch {}
          }

          const exitCode = await proc.exited;
          if (exitCode !== 0 && !killed) {
            const stderrMsg = stderrChunks.join("").trim();
            subscriber.error(
              new Error(
                `[AgyCliProvider] agy exited with code ${exitCode}. Stderr: ${stderrMsg || "<empty>"}`,
              ),
            );
          } else {
            subscriber.complete();
          }
        } catch (err) {
          if (!killed) {
            subscriber.error(err);
          }
        } finally {
          reader.releaseLock();
        }
      };

      readStdout();

      // Teardown: cancellation/unsubscription kills the child process immediately
      return () => {
        killProc();
      };
    });
  }

  protected buildSshArgs(remoteCommand: string): string[] {
    const sshCreds = `${this.config.get("HOST_SSH_USER")}@${this.config.get("HOST_SSH_HOST")}`;
    return [
      "ssh",
      "-T",
      "-i",
      this.config.get("HOST_SSH_KEY_PATH"),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ConnectTimeout=5",
      "-o",
      "LogLevel=ERROR",
      sshCreds,
      remoteCommand,
    ];
  }

  private handleAgyEvent(event: AgyEvent, subscriber: Subscriber<ModelMessage>): void {
    if (event.event === "step_update") {
      const step = event.step_update;

      // Tool handling in agy:
      // When state is ACTIVE -> Tool Call
      if (step.step_type === "tool" && step.state === "ACTIVE") {
        const toolName = step.tool_name || step.tool_info?.name || "unknown_tool";
        const input = (step.tool_info?.parameters ?? {}) as Record<string, unknown>;

        subscriber.next({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: `call_${step.step_index}`,
              toolName,
              input,
            },
          ],
        });
        return;
      }

      // When state is DONE or ERROR -> Tool Result
      if (step.step_type === "tool" && (step.state === "DONE" || step.state === "ERROR")) {
        const toolName = step.tool_name || step.tool_info?.name || "unknown_tool";
        let output:
          | { type: "text"; value: string }
          | { type: "error-text"; value: string }
          | { type: "json"; value: JSONValue };

        if (step.state === "ERROR" || step.tool_info?.error) {
          const err = step.tool_info?.error;
          const errMsg = typeof err === "string" ? err : (err?.message ?? "Tool execution failed");
          output = {
            type: "error-text",
            value: errMsg,
          };
        } else if (typeof step.tool_info?.output === "string") {
          output = {
            type: "text",
            value: step.tool_info.output,
          };
        } else if (step.tool_info?.output !== undefined) {
          output = {
            type: "json",
            value: step.tool_info.output as JSONValue,
          };
        } else {
          output = {
            type: "text",
            value: "",
          };
        }

        subscriber.next({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: `call_${step.step_index}`,
              toolName,
              output,
            },
          ],
        });
        return;
      }
    }

    // Final execution result
    if (event.event === "result") {
      if (event.result.status === "FAILURE") {
        subscriber.error(
          new Error(`[AgyCliProvider] agy execution failed: ${event.result.error || "unknown"}`),
        );
        return;
      }

      const responseText = event.result.response ?? "";
      subscriber.next({
        role: "assistant",
        content: responseText,
      });
    }
  }

  private serializeMessagesToPrompt(messages: ModelMessage[]): string {
    if (messages.length === 0) return "";
    if (messages.length === 1 && typeof messages[0]?.content === "string") {
      return messages[0].content;
    }

    return messages
      .map((msg) => {
        let contentStr = "";
        if (typeof msg.content === "string") {
          contentStr = msg.content;
        } else if (Array.isArray(msg.content)) {
          contentStr = msg.content
            .map((part) => {
              if (part.type === "text") return part.text;
              if (part.type === "tool-call") {
                return `[Tool Call: ${part.toolName} (ID: ${part.toolCallId})] args: ${JSON.stringify(part.input)}`;
              }
              if (part.type === "tool-result") {
                let isError = false;
                let outVal = "";
                switch (part.output.type) {
                  case "text":
                    outVal = part.output.value;
                    break;
                  case "error-text":
                    isError = true;
                    outVal = part.output.value;
                    break;
                  case "json":
                    outVal = JSON.stringify(part.output.value);
                    break;
                  case "execution-denied":
                    isError = true;
                    outVal = `Execution denied: ${part.output.reason ?? "permission rejected"}`;
                    break;
                }
                return `[Tool Result: ${part.toolName} (ID: ${part.toolCallId})] ${isError ? "ERROR: " : ""}${outVal}`;
              }
              if (part.type === "reasoning") {
                return `[Reasoning]: ${part.text}`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
        }
        return `[${msg.role.toUpperCase()}]:\n${contentStr}`;
      })
      .join("\n\n");
  }
}
