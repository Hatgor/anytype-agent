import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ConfigService } from "@nestjs/config";
import type { ModelMessage } from "ai";
import { firstValueFrom, toArray } from "rxjs";
import type { HostConfig } from "../../../../app.config";
import { AgyCliProvider } from "../agy-cli.provider";
import {
  MOCK_AGY_FAILURE_STREAM,
  MOCK_AGY_POST_CURL_STREAM,
  MOCK_AGY_REST_REQUEST_STREAM,
  MOCK_AGY_TEXT_STREAM,
  MOCK_AGY_TOOL_ERROR_STREAM,
  MOCK_AGY_TOOL_SUCCESS_STREAM,
} from "./fixtures/agy-stream.fixtures";

describe("AgyCliProvider (Unit Tests with real AGY wire mocks)", () => {
  let provider: AgyCliProvider;
  let spawnSpy: ReturnType<typeof spyOn>;

  const mockConfig = {
    get: (key: string) => {
      const map: Record<string, string> = {
        HOST_SSH_USER: "testuser",
        HOST_SSH_HOST: "testhost",
        HOST_SSH_KEY_PATH: "/path/to/key",
        HOST_CLI_BIN: "/usr/local/bin/agy",
      };
      return map[key];
    },
  } as unknown as ConfigService<HostConfig, true>;

  function createMockProcess(stdoutText: string, stderrText = "", exitCode = 0) {
    const encoder = new TextEncoder();
    const stdoutStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(stdoutText));
        controller.close();
      },
    });
    const stderrStream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (stderrText) {
          controller.enqueue(encoder.encode(stderrText));
        }
        controller.close();
      },
    });

    const killMock = mock(() => {});

    return {
      stdout: stdoutStream,
      stderr: stderrStream,
      exited: Promise.resolve(exitCode),
      kill: killMock,
    } as unknown as ReturnType<typeof Bun.spawn>;
  }

  beforeEach(() => {
    provider = new AgyCliProvider(mockConfig);
  });

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  it("should parse normal text response stream and emit assistant message", async () => {
    const mockProc = createMockProcess(MOCK_AGY_TEXT_STREAM);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const inputMessages: ModelMessage[] = [
      {
        role: "user",
        content: "Say hello",
      },
    ];

    const events$ = provider.exec(inputMessages).pipe(toArray());
    const events = await firstValueFrom(events$);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      role: "assistant",
      content: "Превед, медвед! И дратути, анон.",
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [args, options] = spawnSpy.mock.calls[0];
    expect(args[0]).toBe("ssh");
    expect(options.stdin).toBeDefined();
  });

  it("should parse tool call and successful tool result", async () => {
    const mockProc = createMockProcess(MOCK_AGY_TOOL_SUCCESS_STREAM);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const inputMessages: ModelMessage[] = [
      {
        role: "user",
        content: "View package.json",
      },
    ];

    const events$ = provider.exec(inputMessages).pipe(toArray());
    const events = await firstValueFrom(events$);

    // Should emit: tool-call -> tool-result -> final assistant message
    expect(events).toHaveLength(3);

    // 1. Tool call
    expect(events[0]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "view_file",
          input: { AbsolutePath: "/Users/hatgor/WORK/OSS/anytype-agent/package.json" },
        },
      ],
    });

    // 2. Tool result
    expect(events[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_2",
          toolName: "view_file",
          output: {
            type: "text",
            value: "42 lines, 968 bytes",
          },
        },
      ],
    });

    // 3. Assistant final text
    expect(events[2]).toEqual({
      role: "assistant",
      content: "Вот содержимое package.json",
    });
  });

  it("should parse tool call and error tool result", async () => {
    const mockProc = createMockProcess(MOCK_AGY_TOOL_ERROR_STREAM);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const inputMessages: ModelMessage[] = [
      {
        role: "user",
        content: "View non-existent file",
      },
    ];

    const events$ = provider.exec(inputMessages).pipe(toArray());
    const events = await firstValueFrom(events$);

    expect(events).toHaveLength(3);

    // Tool call
    expect(events[0].role).toBe("assistant");
    expect(events[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call_2",
        toolName: "view_file",
        input: { AbsolutePath: "/Users/hatgor/WORK/OSS/anytype-agent/non_existent.txt" },
      },
    ]);

    // Tool error result
    expect(events[1].role).toBe("tool");
    expect(events[1].content).toEqual([
      {
        type: "tool-result",
        toolCallId: "call_2",
        toolName: "view_file",
        output: {
          type: "error-text",
          value: "failed to read file: no such file or directory",
        },
      },
    ]);

    // Final assistant response
    expect(events[2]).toEqual({
      role: "assistant",
      content: "Файла не существует!",
    });
  });

  it("should parse REST request tool call (e.g. read_url_content) and result", async () => {
    const mockProc = createMockProcess(MOCK_AGY_REST_REQUEST_STREAM);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const inputMessages: ModelMessage[] = [
      {
        role: "user",
        content: "Make an HTTP GET request to https://httpbin.org/json",
      },
    ];

    const events$ = provider.exec(inputMessages).pipe(toArray());
    const events = await firstValueFrom(events$);

    expect(events).toHaveLength(3);

    // 1. Tool call for read_url_content
    expect(events[0]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "read_url_content",
          input: { Url: "https://httpbin.org/json" },
        },
      ],
    });

    // 2. Tool result for read_url_content (empty text output)
    expect(events[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_2",
          toolName: "read_url_content",
          output: {
            type: "text",
            value: "",
          },
        },
      ],
    });

    // 3. Assistant final text
    expect(events[2]).toEqual({
      role: "assistant",
      content: "Таки сходил по ссылке через read_url_content",
    });
  });

  it("should parse POST request via run_command (curl) tool call and result", async () => {
    const mockProc = createMockProcess(MOCK_AGY_POST_CURL_STREAM);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const inputMessages: ModelMessage[] = [
      {
        role: "user",
        content:
          "Send an HTTP POST request to https://httpbin.org/post with json payload {'hello':'world'}",
      },
    ];

    const events$ = provider.exec(inputMessages).pipe(toArray());
    const events = await firstValueFrom(events$);

    expect(events).toHaveLength(3);

    // 1. Tool call for run_command
    expect(events[0]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call_2",
          toolName: "run_command",
          input: {
            CommandLine:
              'curl -s -X POST https://httpbin.org/post -H "Content-Type: application/json" -d \'{"hello":"world"}\'',
          },
        },
      ],
    });

    // 2. Tool result for run_command
    expect(events[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_2",
          toolName: "run_command",
          output: {
            type: "text",
            value: '{\n  "json": {\n    "hello": "world"\n  }\n}',
          },
        },
      ],
    });

    // 3. Assistant final text
    expect(events[2]).toEqual({
      role: "assistant",
      content: "POST запрос успешно отправлен через curl",
    });
  });

  it("should emit error if agy returns FAILURE result", async () => {
    const mockProc = createMockProcess(MOCK_AGY_FAILURE_STREAM);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const events$ = provider.exec([{ role: "user", content: "Fail please" }]);

    expect(firstValueFrom(events$)).rejects.toThrow("Remote token expired or permission denied");
  });

  it("should emit error if process exits with non-zero code", async () => {
    const mockProc = createMockProcess("", "Permission denied (publickey)", 255);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const events$ = provider.exec([{ role: "user", content: "SSH failure" }]);

    expect(firstValueFrom(events$)).rejects.toThrow(
      "agy exited with code 255. Stderr: Permission denied (publickey)",
    );
  });

  it("should kill child process on unsubscription (cancellation)", async () => {
    // Process stream that never completes on its own
    const killMock = mock(() => {});
    const endlessStream = new ReadableStream<Uint8Array>({
      start() {
        // keep open
      },
    });

    const mockProc = {
      stdout: endlessStream,
      stderr: new ReadableStream<Uint8Array>({
        start(c) {
          c.close();
        },
      }),
      exited: new Promise(() => {}),
      kill: killMock,
    } as unknown as ReturnType<typeof Bun.spawn>;

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(mockProc);

    const sub = provider.exec([{ role: "user", content: "Long task" }]).subscribe();

    expect(killMock).not.toHaveBeenCalled();

    // Trigger teardown
    sub.unsubscribe();

    expect(killMock).toHaveBeenCalledWith("SIGKILL");
  });
});
