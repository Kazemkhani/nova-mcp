/**
 * End-to-end tool tests: a real MCP client connected to the real server
 * over an in-memory transport, with only the network mocked.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NovaConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { TOOL_COUNT } from "../src/tools.js";

const CONFIG: NovaConfig = {
  baseUrl: "https://api.test.nova",
  apiKey: "test-token",
  timeoutMs: 1000,
};

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const UUID2 = "223e4567-e89b-42d3-a456-426614174000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function connect(
  config: NovaConfig,
  fetchMock: ReturnType<typeof vi.fn>,
) {
  const server = buildServer(config, {
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

describe("nova-mcp tools", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("advertises exactly TOOL_COUNT tools with descriptions and schemas", async () => {
    const client = await connect(CONFIG, fetchMock);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_COUNT);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_webhook",
        "delete_webhook",
        "get_call",
        "get_call_brief",
        "get_call_quality",
        "get_demo_token",
        "get_usage",
        "health_check",
        "list_webhooks",
        "place_calls",
        "test_webhook",
        "whoami",
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description, `${tool.name} needs a description`).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("place_calls advertises the demo-mode caveat", async () => {
    const client = await connect(CONFIG, fetchMock);
    const { tools } = await client.listTools();
    const placeCalls = tools.find((t) => t.name === "place_calls");
    expect(placeCalls?.description).toMatch(/DEMO MODE/);
    expect(placeCalls?.description).toMatch(/no real phone/i);
  });

  it("health_check hits /health without auth", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: "healthy",
        timestamp: "t",
        active_calls: 0,
        ttl_seconds: 600,
      }),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "health_check",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/healthy/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test.nova/health");
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("health_check deep=true hits /health/deep", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "healthy", checks: {} }),
    );
    const client = await connect(CONFIG, fetchMock);
    await client.callTool({ name: "health_check", arguments: { deep: true } });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.test.nova/health/deep");
  });

  it("place_calls happy path posts the full CallRequest body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        calls: [
          {
            call_id: UUID,
            context_id: UUID2,
            phone: "+971501234567",
            lead_name: "Ahmed",
            status: "in_progress",
            expires_in_seconds: 599,
            message: "Call dispatched successfully",
          },
        ],
        total: 1,
        dispatched: 1,
        failed: 0,
      }),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "place_calls",
      arguments: {
        owner_email: "owner@example.com",
        product: "AI voice agents for real-estate brokers",
        leads: [{ phone: "+971501234567", name: "Ahmed" }],
        goal: "qualify_interest",
        consent: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/Dispatched 1\/1/);
    expect(textOf(result)).toMatch(/get_demo_token/);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test.nova/calls");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.owner_email).toBe("owner@example.com");
    expect(body.consent).toBe(true);
    expect(body.language).toBe("en");
    expect(body.leads).toEqual([{ phone: "+971501234567", name: "Ahmed" }]);
  });

  it("place_calls rejects consent=false at the schema layer (no HTTP call)", async () => {
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "place_calls",
      arguments: {
        owner_email: "owner@example.com",
        product: "x",
        leads: [{ phone: "+971501234567" }],
        goal: "collect_info",
        consent: false,
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("place_calls rejects invalid E.164 phones at the schema layer", async () => {
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "place_calls",
      arguments: {
        owner_email: "owner@example.com",
        product: "x",
        leads: [{ phone: "0501234567" }],
        goal: "collect_info",
        consent: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/E\.164/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("place_calls enforces booking_link for goal=book_meeting", async () => {
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "place_calls",
      arguments: {
        owner_email: "owner@example.com",
        product: "x",
        leads: [{ phone: "+971501234567" }],
        goal: "book_meeting",
        consent: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/booking_link/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("place_calls enforces payment_link for goal=close_sale", async () => {
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "place_calls",
      arguments: {
        owner_email: "owner@example.com",
        product: "x",
        leads: [{ phone: "+971501234567" }],
        goal: "close_sale",
        consent: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/payment_link/);
  });

  it("place_calls rejects duplicate lead phones", async () => {
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "place_calls",
      arguments: {
        owner_email: "owner@example.com",
        product: "x",
        leads: [{ phone: "+971501234567" }, { phone: "+971501234567" }],
        goal: "collect_info",
        consent: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Duplicate phone/);
  });

  it("get_call returns status and surfaces the TTL hint on 404", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Call not found or expired" }, 404),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "get_call",
      arguments: { call_id: UUID },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/10-minute TTL/);
  });

  it("get_call_brief fetches /contexts/{id}", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: UUID2, opening_line: "Hi!" }),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "get_call_brief",
      arguments: { context_id: UUID2 },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`https://api.test.nova/contexts/${UUID2}`);
  });

  it("get_call_quality flags unscored calls as pending", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ call_id: UUID, scored_at: null, score: null }),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "get_call_quality",
      arguments: { call_id: UUID },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/not been scored yet/);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`https://api.test.nova/api/calls/${UUID}/quality`);
  });

  it("auth-required tools fail with setup guidance when NOVA_API_KEY is missing", async () => {
    const client = await connect({ ...CONFIG, apiKey: undefined }, fetchMock);
    for (const name of ["whoami", "get_usage", "list_webhooks"]) {
      const result = (await client.callTool({
        name,
        arguments: {},
      })) as CallToolResult;
      expect(result.isError, `${name} should error without a key`).toBe(true);
      expect(textOf(result)).toMatch(/NOVA_API_KEY/);
      expect(textOf(result)).toMatch(/auth\/login/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("create_webhook requires https URLs and known event types", async () => {
    const client = await connect(CONFIG, fetchMock);
    const badUrl = (await client.callTool({
      name: "create_webhook",
      arguments: {
        url: "http://insecure.example.com/hook",
        events: ["call.started"],
      },
    })) as CallToolResult;
    expect(badUrl.isError).toBe(true);

    const badEvent = (await client.callTool({
      name: "create_webhook",
      arguments: { url: "https://example.com/hook", events: ["call.exploded"] },
    })) as CallToolResult;
    expect(badEvent.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("create_webhook surfaces the show-once secret warning", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: UUID,
          url: "https://example.com/hook",
          events: ["call.started"],
          secret: "whsec_abc",
          is_active: true,
          created_at: "now",
        },
        201,
      ),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "create_webhook",
      arguments: { url: "https://example.com/hook", events: ["call.started"] },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/shown exactly once/);
  });

  it("delete_webhook handles 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "delete_webhook",
      arguments: { webhook_id: UUID },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/"deleted": true/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.test.nova/v1/webhooks/${UUID}`);
    expect(init.method).toBe("DELETE");
  });

  it("get_demo_token derives room name call-<context_id>", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        server_url: "wss://lk.test",
        participant_token: "jwt",
        room_name: `call-${UUID2}`,
      }),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "get_demo_token",
      arguments: { context_id: UUID2 },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test.nova/token");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.room_name).toBe(`call-${UUID2}`);
    expect(body.participant_name).toBe("Demo Caller");
  });

  it("get_demo_token requires context_id or room_name", async () => {
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "get_demo_token",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/context_id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("network failures surface actionable errors through tools", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      }),
    );
    const client = await connect(CONFIG, fetchMock);
    const result = (await client.callTool({
      name: "get_call",
      arguments: { call_id: UUID },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Could not reach/);
    expect(textOf(result)).toMatch(/NOVA_API_URL/);
  });
});
