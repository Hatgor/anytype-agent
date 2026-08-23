import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { AnytypeClient } from "../index";
import type { AppConfig } from "../../config/schema";

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
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
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

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

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

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = new AnytypeClient(mockConfig);
      const space = await client.getSpace("space.123");

      expect(space.id).toBe("space.123");
      expect(space.name).toBe("Work Space");
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

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

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

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

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

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

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

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(mockCreated), { status: 201 })
      );

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
      // Missing required field 'name' and invalid enum 'role'
      const invalidResponse = {
        data: [
          {
            id: "_participant_1",
            identity: "id-1",
            // missing 'name'
            role: "invalid_super_role", // invalid role enum
            status: "active",
          },
        ],
      };

      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify(invalidResponse), { status: 200 })
      );

      const client = new AnytypeClient(mockConfig);

      await expect(client.getMembers("space1")).rejects.toThrow(
        /Schema validation failed for \/v1\/spaces\/space1\/members/
      );
    });

    it("throws HTTP error when status is not 2xx", async () => {
      fetchSpy.mockResolvedValue(
        new Response("Unauthorized: Invalid token", {
          status: 401,
          statusText: "Unauthorized",
        })
      );

      const client = new AnytypeClient(mockConfig);

      await expect(client.getSpaces()).rejects.toThrow(
        /\[AnytypeClient HTTP 401\] GET \/v1\/spaces: Unauthorized: Invalid token/
      );
    });

    it("throws connection error on network failure", async () => {
      fetchSpy.mockRejectedValue(new Error("Connection refused (ECONNREFUSED)"));

      const client = new AnytypeClient(mockConfig);

      await expect(client.getSpaces()).rejects.toThrow(
        /Connection failed to http:\/\/127.0.0.1:31012\/v1\/spaces: Connection refused/
      );
    });
  });
});
