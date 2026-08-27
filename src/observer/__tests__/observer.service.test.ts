import "reflect-metadata";
import { describe, expect, it, mock } from "bun:test";
import type { ConfigService } from "@nestjs/config";
import { throwError } from "rxjs";
import type { AppConfig } from "../../app.config";
import type { AnytypeService, Member } from "../../client";
import { ObserverService } from "../observer.service";
import type { AbstractObserver, ObserverFactory } from "../types";
import { callCount, makeFakeObserver, type ObserverServiceInternals } from "./helpers";

describe("ObserverService (Unit Tests)", () => {
  const createMockConfig = (botName = "TestBot", scanIntervalMs = 60000) => {
    return {
      get: (key: string) => {
        if (key === "ANYTYPE_BOT_NAME") return botName;
        if (key === "OBSERVER_SCAN_INTERVAL_MS") return scanIntervalMs;
        return undefined;
      },
    } as unknown as ConfigService<AppConfig, true>;
  };

  const makeSpaceWithMembers = (
    id: string,
    name: string,
    role = "editor",
    botName = "TestBot",
    status = "active",
  ) => ({
    id,
    name,
    members: [
      {
        identity: botName,
        name: botName,
        role,
        status,
      } as Member,
    ],
  });

  it("1. Регрессия на фикс порядка: синхронная ошибка в run() не оставляет зомби в registry", async () => {
    const destroySpy = mock(() => {});
    const fakeObserver = makeFakeObserver(
      throwError(() => new Error("sync boom")),
      destroySpy,
    );

    const fakeFactory: ObserverFactory = {
      create: mock(() => fakeObserver),
    };

    const anytypeFake = {
      getSpacesWithMembers: mock(async () => [
        makeSpaceWithMembers("space.boom", "Boom Space", "editor"),
      ]),
    } as unknown as AnytypeService;

    const svc = new ObserverService(anytypeFake, [fakeFactory], createMockConfig());
    const internals = svc as unknown as ObserverServiceInternals;

    await internals.checkSpaces();

    expect(internals.registry.has("space.boom")).toBe(false);
    expect(callCount(destroySpy)).toBe(1);
  });

  it("2. Роли и доступ: спейс с bot-editor -> обсервер создан; viewer / нет бота / пустое имя -> не создан", async () => {
    const createdObservers: AbstractObserver[] = [];
    const fakeFactory: ObserverFactory = {
      create: mock((_id: string, _botName: string) => {
        const obs = makeFakeObserver();
        createdObservers.push(obs);
        return obs;
      }),
    };

    const spaces = [
      makeSpaceWithMembers("space.valid", "Valid Space", "editor"),
      makeSpaceWithMembers("space.admin", "Admin Space", "admin"),
      makeSpaceWithMembers("space.owner", "Owner Space", "owner"),
      makeSpaceWithMembers("space.viewer", "Viewer Space", "viewer"),
      makeSpaceWithMembers("space.emptyname", "", "editor"),
      {
        id: "space.nobot",
        name: "No Bot Space",
        members: [
          { identity: "other_user", name: "Alice", role: "editor", status: "active" } as Member,
        ],
      },
      makeSpaceWithMembers("space.inactive", "Inactive Bot Space", "editor", "TestBot", "invited"),
    ];

    const anytypeFake = {
      getSpacesWithMembers: mock(async () => spaces),
    } as unknown as AnytypeService;

    const svc = new ObserverService(anytypeFake, [fakeFactory], createMockConfig());
    const internals = svc as unknown as ObserverServiceInternals;

    await internals.checkSpaces();

    expect(internals.registry.has("space.valid")).toBe(true);
    expect(internals.registry.has("space.admin")).toBe(true);
    expect(internals.registry.has("space.owner")).toBe(true);
    expect(internals.registry.has("space.viewer")).toBe(false);
    expect(internals.registry.has("space.emptyname")).toBe(false);
    expect(internals.registry.has("space.nobot")).toBe(false);
    expect(internals.registry.has("space.inactive")).toBe(false);
    expect(callCount(fakeFactory.create)).toBe(3);
  });

  it("3. Пропавший спейс: второй checkSpaces без спейса -> destroy вызван, registry очищен", async () => {
    const destroySpy = mock(() => {});
    const fakeFactory: ObserverFactory = {
      create: mock(() => makeFakeObserver(undefined, destroySpy)),
    };

    let spacesList = [makeSpaceWithMembers("space.1", "Space 1", "editor")];

    const anytypeFake = {
      getSpacesWithMembers: mock(async () => spacesList),
    } as unknown as AnytypeService;

    const svc = new ObserverService(anytypeFake, [fakeFactory], createMockConfig());
    const internals = svc as unknown as ObserverServiceInternals;

    // 1-й скан: спейс зарегистрирован
    await internals.checkSpaces();
    expect(internals.registry.has("space.1")).toBe(true);
    expect(callCount(destroySpy)).toBe(0);

    // 2-й скан: спейс пропал из Anytype
    spacesList = [];
    await internals.checkSpaces();
    expect(internals.registry.has("space.1")).toBe(false);
    expect(callCount(destroySpy)).toBe(1);
  });

  it("4. Дубликаты: два checkSpaces с тем же спейсом -> factory.create ровно 1 раз", async () => {
    const fakeFactory: ObserverFactory = {
      create: mock(() => makeFakeObserver()),
    };

    const anytypeFake = {
      getSpacesWithMembers: mock(async () => [
        makeSpaceWithMembers("space.dup", "Duplicate Test Space", "editor"),
      ]),
    } as unknown as AnytypeService;

    const svc = new ObserverService(anytypeFake, [fakeFactory], createMockConfig());
    const internals = svc as unknown as ObserverServiceInternals;

    await internals.checkSpaces();
    await internals.checkSpaces();
    await internals.checkSpaces();

    expect(callCount(fakeFactory.create)).toBe(1);
    expect(internals.registry.size).toBe(1);
  });
});
