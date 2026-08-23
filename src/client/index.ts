import { type TSchema, type Static } from "typebox";
import Value from "typebox/value";
import type { AppConfig } from "../config/schema";
import {
  Space,
  SpacesResponse,
  SpaceResponse,
  Member,
  MembersResponse,
  MemberResponse,
  AnytypeType,
  TypesResponse,
  TypeResponse,
  CreateTypeRequest,
} from "./schemas";

export * from "./schemas";

export class AnytypeClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;

  constructor(config: AppConfig, apiVersion = "2025-11-08") {
    this.baseUrl = config.ANYTYPE_API_URL.replace(/\/$/, "");
    this.apiKey = config.ANYTYPE_API_KEY;
    this.apiVersion = apiVersion;
  }

  private async request<T extends TSchema>(
    schema: T,
    path: string,
    options: RequestInit = {}
  ): Promise<Static<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Anytype-Version": this.apiVersion,
      Authorization: `Bearer ${this.apiKey}`,
      ...(options.headers as Record<string, string> | undefined),
    };

    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
      });
    } catch (err: any) {
      throw new Error(`[AnytypeClient] Connection failed to ${url}: ${err.message}`);
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(
        `[AnytypeClient HTTP ${res.status}] ${options.method || "GET"} ${path}: ${errorBody || res.statusText}`
      );
    }

    const raw = await res.json();
    try {
      return Value.Parse(schema, raw);
    } catch (err: any) {
      const errors = [...Value.Errors(schema, raw)]
        .map((e) => `  - ${e.instancePath || "/"}: ${e.message} (schema: ${e.schemaPath})`)
        .join("\n");
      throw new Error(
        `[AnytypeClient] Schema validation failed for ${path}:\n${errors}\nPayload: ${JSON.stringify(raw, null, 2)}`
      );
    }
  }

  // --- Spaces ---

  async getSpaces(): Promise<Space[]> {
    const res = await this.request(SpacesResponse, "/v1/spaces");
    return res.data;
  }

  async getSpace(spaceId: string): Promise<Space> {
    const res = await this.request(SpaceResponse, `/v1/spaces/${encodeURIComponent(spaceId)}`);
    return res.space;
  }

  // --- Members & Permissions ---

  async getMembers(spaceId: string): Promise<Member[]> {
    const res = await this.request(
      MembersResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/members`
    );
    return res.data;
  }

  async getMember(spaceId: string, memberId: string): Promise<Member> {
    const res = await this.request(
      MemberResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(memberId)}`
    );
    return res.member;
  }

  // --- Types ---

  async getTypes(spaceId: string): Promise<AnytypeType[]> {
    const res = await this.request(
      TypesResponse,
      `/v1/spaces/${encodeURIComponent(spaceId)}/types`
    );
    return res.data;
  }

  async createType(payload: CreateTypeRequest): Promise<AnytypeType> {
    const res = await this.request(
      TypeResponse,
      `/v1/spaces/${encodeURIComponent(payload.space_id)}/types`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    return res.type;
  }
}
