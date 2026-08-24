import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { firstValueFrom } from "rxjs";
import type { AppConfig } from "../../config/schema";
import { AnytypeClient } from "../index";

describe("AnytypeClient", () => {
  const mockConfig: AppConfig = {
    ANYTYPE_API_URL: "http://127.0.0.1:31012/",
    ANYTYPE_BOT_NAME: "GeminiBot",
    ANYTYPE_API_KEY: "secret-token-xyz",
  };

  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("Configuration & Headers", () => {
    it("should strip trailing slashes from baseUrl", () => {
      const client = new AnytypeClient(mockConfig);
      expect(client.baseUrl).toBe("http://127.0.0.1:31012");
    });

    it("should pass standard headers on requests", async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [],
            pagination: { total: 0, offset: 0, limit: 100, has_more: false },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const client = new AnytypeClient(mockConfig, "2025-11-08");
      await client.getSpaces();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:31012/v1/spaces");
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        "Anytype-Version": "2025-11-08",
        Authorization: "Bearer secret-token-xyz",
      });
    });
  });

  describe("Spaces API", () => {
    it("getSpaces: validates and returns space list", async () => {
      const mockResponse = {
        data: [
          {
            id: "space.123",
            name: "Work Space",
            description: "Main workspace",
            network_id: "net.abc",
            gateway_url: "http://127.0.0.1:47800",
            icon: { format: "emoji", emoji: "🚀" },
            object: "anytype.space",
          },
        ],
        pagination: { total: 1, offset: 0, limit: 100, has_more: false },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      const spaces = await client.getSpaces();

      expect(spaces).toHaveLength(1);
      expect(spaces[0]!.id).toBe("space.123");
      expect(spaces[0]!.name).toBe("Work Space");
    });

    it("getSpace: validates and returns single space", async () => {
      const mockResponse = {
        space: {
          id: "space.123",
          name: "Work Space",
          icon: null,
        },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      const space = await client.getSpace("space.123");

      expect(space.id).toBe("space.123");
      expect(space.name).toBe("Work Space");
    });
  });

  describe("Chats & SSE API", () => {
    it("getChats: validates and returns chat list", async () => {
      const mockResponse = {
        data: [
          {
            id: "chat.123",
            name: "Chat with GeminiBot",
            space_id: "space1",
          },
        ],
        pagination: { total: 1, offset: 0, limit: 100, has_more: false },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      const chats = await client.getChats("space1");

      expect(chats).toHaveLength(1);
      expect(chats[0]!.id).toBe("chat.123");
    });

    it("subscribeChatMessages: streams and parses SSE events as Observable", async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: {"id":"msg1","text":"Hello bot!","author_id":"user1","created_at":1700000000}\n\n`,
            ),
          );
          controller.close();
        },
      });

      fetchSpy.mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );

      const client = new AnytypeClient(mockConfig);
      const rawEvent = await firstValueFrom(client.subscribeChatMessages("space1", "chat1"));

      expect(rawEvent.data.id).toBe("msg1");
      expect(rawEvent.data.text).toBe("Hello bot!");
      expect(rawEvent.data.author_id).toBe("user1");
    });
  });

  describe("Members & Permissions API", () => {
    it("getMembers: validates and returns member list with roles", async () => {
      const mockResponse = {
        data: [
          {
            id: "_participant_space1_user1",
            identity: "identity-1",
            name: "Andrii",
            role: "owner",
            status: "active",
            global_name: "andrii.any",
            icon: null,
          },
          {
            id: "_participant_space1_bot1",
            identity: "identity-bot",
            name: "GeminiBot",
            role: "editor",
            status: "active",
            icon: null,
          },
        ],
        pagination: { total: 2, offset: 0, limit: 100, has_more: false },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      const members = await client.getMembers("space1");

      expect(members).toHaveLength(2);
      expect(members[0]!.role).toBe("owner");
      expect(members[1]!.role).toBe("editor");
      expect(members[1]!.name).toBe("GeminiBot");
    });

    it("getMember: validates and returns single member", async () => {
      const mockResponse = {
        member: {
          id: "_participant_space1_bot1",
          identity: "identity-bot",
          name: "GeminiBot",
          role: "editor",
          status: "active",
        },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      const member = await client.getMember("space1", "member1");

      expect(member.id).toBe("_participant_space1_bot1");
      expect(member.role).toBe("editor");
    });
  });

  describe("Types API", () => {
    it("getTypes: validates and returns types list", async () => {
      const mockResponse = {
        data: [
          {
            id: "type.task",
            key: "task",
            name: "Task",
            plural_name: "Tasks",
            layout: "action",
            archived: false,
            properties: [
              { key: "status", name: "Status", format: "select" },
              { key: "done", name: "Done", format: "checkbox" },
            ],
          },
        ],
        pagination: { total: 1, offset: 0, limit: 100, has_more: false },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      const types = await client.getTypes("space1");

      expect(types).toHaveLength(1);
      expect(types[0]!.key).toBe("task");
      expect(types[0]!.properties).toHaveLength(2);
    });

    it("createType: sends POST request and validates created type response", async () => {
      const mockCreated = {
        type: {
          id: "type.agent_response",
          key: "agent_response",
          name: "Agent Response",
          plural_name: "Agent Responses",
          layout: "note",
        },
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockCreated), { status: 201 }));

      const client = new AnytypeClient(mockConfig);
      const created = await client.createType({
        space_id: "space1",
        name: "Agent Response",
        plural_name: "Agent Responses",
        layout: "note",
        key: "agent_response",
      });

      expect(created.id).toBe("type.agent_response");
      expect(created.name).toBe("Agent Response");

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:31012/v1/spaces/space1/types");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        space_id: "space1",
        name: "Agent Response",
        plural_name: "Agent Responses",
        layout: "note",
        key: "agent_response",
      });
    });
  });

  describe("Validation & Error Handling", () => {
    it("throws detailed error when response does not match TypeBox schema", async () => {
      const invalidResponse = {
        data: [
          {
            id: "_participant_1",
            identity: "id-1",
            role: "invalid_super_role",
            status: "active",
          },
        ],
      };

      fetchSpy.mockResolvedValue(new Response(JSON.stringify(invalidResponse), { status: 200 }));

      const client = new AnytypeClient(mockConfig);

      await expect(client.getMembers("space1")).rejects.toThrow(
        /Schema validation failed for \/v1\/spaces\/space1\/members/,
      );
    });

    it("throws HTTP error when status is not 2xx", async () => {
      fetchSpy.mockResolvedValue(
        new Response("Unauthorized: Invalid token", {
          status: 401,
          statusText: "Unauthorized",
        }),
      );

      const client = new AnytypeClient(mockConfig);

      await expect(client.getSpaces()).rejects.toThrow(
        /\[AnytypeClient HTTP 401\] GET \/v1\/spaces: Unauthorized: Invalid token/,
      );
    });

    it("throws connection error on network failure", async () => {
      fetchSpy.mockRejectedValue(new Error("Connection refused (ECONNREFUSED)"));

      const client = new AnytypeClient(mockConfig);

      await expect(client.getSpaces()).rejects.toThrow(
        /Connection failed to http:\/\/127.0.0.1:31012\/v1\/spaces: Connection refused/,
      );
    });
  });

  describe("waitForReady (RxJS Pipeline)", () => {
    it("resolves immediately when API is healthy on first attempt", async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

      const client = new AnytypeClient(mockConfig);
      await client.waitForReady(3, 10);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("retries with delay and succeeds after initial failures", async () => {
      let callCount = 0;
      fetchSpy.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("Connection refused");
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const client = new AnytypeClient(mockConfig);
      await client.waitForReady(5, 10);

      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("throws error when max attempts are exceeded", async () => {
      fetchSpy.mockRejectedValue(new Error("Connection refused"));

      const client = new AnytypeClient(mockConfig);

      await expect(client.waitForReady(3, 10)).rejects.toThrow(
        /API at http:\/\/127.0.0.1:31012 is still unreachable after 3 attempts/,
      );
    });
  });
});
