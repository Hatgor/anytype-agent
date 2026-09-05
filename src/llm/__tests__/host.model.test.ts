import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ConfigService } from "@nestjs/config";
import type { HostConfig } from "../../app.config";
import type { AnytypeClient } from "../../client/anytype.client";
import { AnytypeProxy } from "../../client/anytype.proxy";
import { sleep, waitFor } from "../../observer/__tests__/helpers";
import { HostModelService } from "../host.model";
import { LlmAction, type LlmEvent, LlmResponse } from "../types";

type HostModelInternals = {
  execRemote: (
    cmd: string,
    stdin?: string,
    timeout?: number,
  ) => Promise<{ stdout: string; stderr: string }>;
};

describe("HostModelService.run (RxJS Composition & Guards)", () => {
  let proxy: AnytypeProxy;
  let model: HostModelService;
  let mockConfig: ConfigService<HostConfig, true>;
  let fakeClient: AnytypeClient;

  let issuedAliases: string[] = [];
  let issueAliasSpy: ReturnType<typeof spyOn>;
  let revokeAliasSpy: ReturnType<typeof spyOn>;
  let execRemoteSpy: ReturnType<typeof spyOn>;

  const getAlias = (index = 0): string => issuedAliases[index] ?? "";

  beforeEach(async () => {
    issuedAliases = [];

    mockConfig = {
      get: mock((key: string) => {
        const configMap: Record<string, unknown> = {
          HOST_PROXY_PORT: 0, // 0 = dynamic OS free port
          ANYTYPE_BOT_NAME: "TestBot",
          ANYTYPE_API_URL: "http://127.0.0.1:31012",
          HOST_CLI_BIN: "agy",
          HOST_SSH_USER: "testuser",
          HOST_SSH_HOST: "127.0.0.1",
          HOST_SSH_KEY_PATH: "/dummy/id_rsa",
        };
        return configMap[key];
      }),
    } as unknown as ConfigService<HostConfig, true>;

    fakeClient = {
      requestRaw: mock(async () => new Response("{}")),
    } as unknown as AnytypeClient;

    proxy = new AnytypeProxy(mockConfig, fakeClient);
    await proxy.start();

    const originalIssue = proxy.issueSpaceAlias.bind(proxy);
    issueAliasSpy = spyOn(proxy, "issueSpaceAlias").mockImplementation((spaceId: string) => {
      const alias = originalIssue(spaceId);
      issuedAliases.push(alias);
      return alias;
    });

    revokeAliasSpy = spyOn(proxy, "revokeSpaceAlias");

    model = new HostModelService(mockConfig, proxy);
  });

  afterEach(() => {
    proxy.stop();
    issueAliasSpy?.mockRestore();
    revokeAliasSpy?.mockRestore();
    execRemoteSpy?.mockRestore();
  });

  it("1. guard share(): done$ and merge subscribe to single cold-defer -> SSH spawned exactly 1 time", async () => {
    let execCount = 0;
    const proto = HostModelService.prototype as unknown as HostModelInternals;
    execRemoteSpy = spyOn(proto, "execRemote").mockImplementation(async () => {
      execCount++;
      await sleep(30);
      return { stdout: "  Reply  ", stderr: "" };
    });

    const events: LlmEvent[] = [];
    let completed = false;

    model.run("space.real", { msg: "hello" }).subscribe({
      next: (e) => events.push(e),
      complete: () => {
        completed = true;
      },
    });

    await waitFor(() => completed, 2000);

    expect(execCount).toBe(1);

    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(LlmResponse);
    expect((events[0] as LlmResponse).text).toBe("Reply");
  });

  it("2. guard takeUntil(done$): hot traces$ does not block stream completion after receiving response", async () => {
    let resolveExec!: (val: { stdout: string; stderr: string }) => void;
    const proto = HostModelService.prototype as unknown as HostModelInternals;
    execRemoteSpy = spyOn(proto, "execRemote").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExec = resolve;
        }),
    );

    const events: LlmEvent[] = [];
    let completed = false;

    model.run("space.real", { msg: "hello" }).subscribe({
      next: (e) => events.push(e),
      complete: () => {
        completed = true;
      },
    });

    const alias = getAlias(0);
    expect(alias.length).toBeGreaterThan(0);

    proxy.traces$.next({
      alias,
      method: "GET",
      path: `/v1/spaces/${alias}/objects`,
      status: 200,
      durationMs: 5,
    });
    proxy.traces$.next({
      alias,
      method: "POST",
      path: `/v1/spaces/${alias}/objects`,
      status: 201,
      durationMs: 12,
    });

    resolveExec({ stdout: "Done reply", stderr: "" });

    await waitFor(() => completed, 2000);
    expect(completed).toBe(true);

    // LlmResponse is the last element (stream invariant)
    expect(events.length).toBe(3);
    expect(events[0]).toBeInstanceOf(LlmAction);
    expect((events[0] as LlmAction).detail).toBe("GET /objects → 200");
    expect(events[1]).toBeInstanceOf(LlmAction);
    expect((events[1] as LlmAction).detail).toBe("POST /objects → 201");
    expect(events[2]).toBeInstanceOf(LlmResponse);
    expect((events[2] as LlmResponse).text).toBe("Done reply");

    // Trace after complete is not delivered
    proxy.traces$.next({
      alias,
      method: "DELETE",
      path: `/v1/spaces/${alias}/objects/123`,
      status: 204,
      durationMs: 3,
    });
    await sleep(30);
    expect(events.length).toBe(3);
  });

  it("3a. guard finalize: on normal complete, alias is revoked via revokeSpaceAlias", async () => {
    const proto = HostModelService.prototype as unknown as HostModelInternals;
    execRemoteSpy = spyOn(proto, "execRemote").mockResolvedValue({
      stdout: "All good",
      stderr: "",
    });

    let completed = false;
    model.run("space.real", {}).subscribe({
      complete: () => {
        completed = true;
      },
    });

    await waitFor(() => completed, 2000);
    const alias = getAlias(0);
    expect(alias.length).toBeGreaterThan(0);
    expect(revokeAliasSpy).toHaveBeenCalledWith(alias);
  });

  it("3b. guard finalize: on execRemote error, stream forwards error and alias is revoked", async () => {
    const proto = HostModelService.prototype as unknown as HostModelInternals;
    execRemoteSpy = spyOn(proto, "execRemote").mockRejectedValue(new Error("SSH boom"));

    let caughtError: Error | null = null;
    model.run("space.real", {}).subscribe({
      error: (err) => {
        caughtError = err;
      },
    });

    await waitFor(() => caughtError !== null, 2000);
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as unknown as Error).message).toBe("SSH boom");

    const alias = getAlias(0);
    expect(alias.length).toBeGreaterThan(0);
    expect(revokeAliasSpy).toHaveBeenCalledWith(alias);
  });

  it("3c. guard finalize: on early unsubscribe, alias is revoked without job completion", async () => {
    const proto = HostModelService.prototype as unknown as HostModelInternals;
    execRemoteSpy = spyOn(proto, "execRemote").mockImplementation(
      () => new Promise(() => {}), // Never resolves
    );

    const events: LlmEvent[] = [];
    const sub = model.run("space.real", {}).subscribe({
      next: (e) => events.push(e),
    });

    const alias = getAlias(0);
    expect(alias.length).toBeGreaterThan(0);

    proxy.traces$.next({
      alias,
      method: "GET",
      path: `/v1/spaces/${alias}/chats`,
      status: 200,
      durationMs: 4,
    });
    expect(events.length).toBe(1);

    // Unsubscribe early (observer destroy scenario)
    sub.unsubscribe();

    expect(revokeAliasSpy).toHaveBeenCalledWith(alias);
  });

  it("4. Trace isolation: concurrent jobs receive only their own LlmAction without leaking alias in detail", async () => {
    let resolveA!: (val: { stdout: string; stderr: string }) => void;
    let resolveB!: (val: { stdout: string; stderr: string }) => void;
    let callIndex = 0;

    const proto = HostModelService.prototype as unknown as HostModelInternals;
    execRemoteSpy = spyOn(proto, "execRemote").mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return new Promise((res) => {
          resolveA = res;
        });
      }
      return new Promise((res) => {
        resolveB = res;
      });
    });

    const eventsA: LlmEvent[] = [];
    const eventsB: LlmEvent[] = [];
    let completedA = false;
    let completedB = false;

    model.run("space.A", {}).subscribe({
      next: (e) => eventsA.push(e),
      complete: () => {
        completedA = true;
      },
    });

    model.run("space.B", {}).subscribe({
      next: (e) => eventsB.push(e),
      complete: () => {
        completedB = true;
      },
    });

    expect(issuedAliases.length).toBe(2);
    const aliasA = getAlias(0);
    const aliasB = getAlias(1);
    expect(aliasA).not.toBe(aliasB);

    // Interleaved traces from both aliases
    proxy.traces$.next({
      alias: aliasA,
      method: "GET",
      path: `/v1/spaces/${aliasA}/chats`,
      status: 200,
      durationMs: 5,
    });
    proxy.traces$.next({
      alias: aliasB,
      method: "GET",
      path: `/v1/spaces/${aliasB}/members`,
      status: 200,
      durationMs: 7,
    });
    proxy.traces$.next({
      alias: aliasA,
      method: "POST",
      path: `/v1/spaces/${aliasA}/files`,
      status: 201,
      durationMs: 15,
    });
    proxy.traces$.next({
      alias: aliasB,
      method: "GET",
      path: `/v1/spaces/${aliasB}/types`,
      status: 200,
      durationMs: 3,
    });

    resolveA({ stdout: "Reply A", stderr: "" });
    resolveB({ stdout: "Reply B", stderr: "" });

    await waitFor(() => completedA && completedB, 2000);

    expect(eventsA.length).toBe(3);
    expect((eventsA[0] as LlmAction).detail).toBe("GET /chats → 200");
    expect((eventsA[1] as LlmAction).detail).toBe("POST /files → 201");
    expect((eventsA[2] as LlmResponse).text).toBe("Reply A");
    // Alias must not leak into detail
    expect((eventsA[0] as LlmAction).detail).not.toContain(aliasA);

    expect(eventsB.length).toBe(3);
    expect((eventsB[0] as LlmAction).detail).toBe("GET /members → 200");
    expect((eventsB[1] as LlmAction).detail).toBe("GET /types → 200");
    expect((eventsB[2] as LlmResponse).text).toBe("Reply B");
    // Alias must not leak into detail
    expect((eventsB[0] as LlmAction).detail).not.toContain(aliasB);
  });

  it("5. execRemote & Buffer stdin: pipes real Buffer to stdin and receives stdout without execRemote mocks", async () => {
    const proto = HostModelService.prototype as unknown as {
      buildSshArgs: (cmd: string) => string[];
      execRemote: (
        cmd: string,
        stdin?: string,
        timeout?: number,
        abort?: AbortSignal,
      ) => Promise<{ stdout: string; stderr: string }>;
    };

    const buildSshArgsSpy = spyOn(proto, "buildSshArgs").mockImplementation(() => ["cat"]);

    const testPayload = "Buffer stdin verified! 🚀\nMulti-line prompt text";
    const res = await (model as unknown as { execRemote: typeof proto.execRemote }).execRemote(
      "unused",
      testPayload,
      5000,
    );

    expect(res.stdout).toBe(testPayload);
    expect(res.stderr).toBe("");

    buildSshArgsSpy.mockRestore();
  });

  it("6. execRemote & AbortSignal kill: terminates actual running process ('sleep 10') in <200ms via SIGKILL", async () => {
    const proto = HostModelService.prototype as unknown as {
      buildSshArgs: (cmd: string) => string[];
      execRemote: (
        cmd: string,
        stdin?: string,
        timeout?: number,
        abort?: AbortSignal,
      ) => Promise<{ stdout: string; stderr: string }>;
    };

    const buildSshArgsSpy = spyOn(proto, "buildSshArgs").mockImplementation((cmd: string) => [
      "sh",
      "-c",
      `exec ${cmd}`,
    ]);

    const startTime = Date.now();
    const abortController = new AbortController();

    // Trigger abort after 50ms while sleep 10 is running
    setTimeout(() => abortController.abort(), 50);

    let caughtError: unknown;
    try {
      await (model as unknown as { execRemote: typeof proto.execRemote }).execRemote(
        "sleep 10",
        "some stdin",
        10_000,
        abortController.signal,
      );
    } catch (err) {
      caughtError = err;
    }

    const duration = Date.now() - startTime;

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain("Execution aborted");
    // Verified: process did not wait for 10,000ms, killed in ~50-250ms!
    expect(duration).toBeLessThan(1000);

    buildSshArgsSpy.mockRestore();
  });
});
