#!/usr/bin/env node
/**
 * NOVA Labs MCP server — gives AI agents the ability to create voice agents,
 * place outbound calls, and read call transcripts via the NOVA API.
 *
 * Transport: stdio (the canonical local MCP transport).
 *
 * Configuration via environment variables:
 *   NOVA_API_BASE     — defaults to https://api.novalabs.ae
 *   NOVA_API_KEY      — required; obtain from https://novalabs.ae/dashboard
 *   NOVA_TIMEOUT_MS   — defaults to 30000 (30 seconds)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createAgent,
  startCall,
  getTranscript,
  NovaClient,
  type NovaClientOptions,
} from "./nova-client.js";

const PACKAGE_VERSION = "0.1.0";

// ---------- tool schemas ----------
const CreateAgentInput = z.object({
  name: z.string().min(1).max(80).describe("Display name for the agent."),
  url: z
    .string()
    .url()
    .describe(
      "Website URL NOVA scrapes for product context (description, pricing, offer).",
    ),
  goal: z
    .enum(["book_meeting", "qualify_lead", "close_sale", "collect_info"])
    .default("book_meeting")
    .describe("Primary outcome the agent drives toward on every call."),
  voice: z
    .enum(["sara_en", "layla_ar", "khalid_en", "noor_en"])
    .default("sara_en")
    .describe(
      "Voice persona. EN voices fluent in MENA accents; AR voice is Gulf-tuned.",
    ),
  language: z
    .enum(["en", "ar", "hi", "ur"])
    .default("en")
    .describe("Primary call language. English, Arabic, Hindi, or Urdu."),
});

const StartCallInput = z.object({
  agent_id: z.string().min(1).describe("Agent ID returned by create_agent."),
  phone_number: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/)
    .describe("International E.164 format with leading +, e.g. +971501234567."),
  lead_name: z
    .string()
    .min(1)
    .max(80)
    .describe("Lead's name for personalisation."),
  lead_context: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Optional free-text context the agent reads before dialling (last interaction, source, etc.).",
    ),
});

const GetTranscriptInput = z.object({
  call_id: z.string().min(1).describe("Call ID returned by start_call."),
  format: z
    .enum(["plain", "json"])
    .default("plain")
    .describe(
      "Plain returns a human-readable transcript; json returns turn-by-turn structured data.",
    ),
});

type CreateAgentArgs = z.infer<typeof CreateAgentInput>;
type StartCallArgs = z.infer<typeof StartCallInput>;
type GetTranscriptArgs = z.infer<typeof GetTranscriptInput>;

// ---------- server bootstrap ----------
function loadOptions(): NovaClientOptions {
  const apiKey = process.env.NOVA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NOVA_API_KEY environment variable is required. Get one at https://novalabs.ae/dashboard.",
    );
  }
  return {
    baseUrl: process.env.NOVA_API_BASE ?? "https://api.novalabs.ae",
    apiKey,
    timeoutMs: Number(process.env.NOVA_TIMEOUT_MS ?? 30_000),
  };
}

async function main() {
  const options = loadOptions();
  const client = new NovaClient(options);

  const server = new Server(
    {
      name: "nova-mcp",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List tools — schemas advertised to the calling LLM.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_agent",
        description:
          "Create a new NOVA voice agent from a website URL. NOVA scrapes the site, builds product context, and returns an agent_id ready to place calls. Typical use: 'create an agent for thisCompany.com that books demos'.",
        inputSchema: zodToJsonSchema(CreateAgentInput),
      },
      {
        name: "start_call",
        description:
          "Start an outbound call from a NOVA agent to a phone number. Returns a call_id you can poll with get_transcript. The agent identifies as AI and announces recording on the line.",
        inputSchema: zodToJsonSchema(StartCallInput),
      },
      {
        name: "get_transcript",
        description:
          "Fetch the call transcript and outcome label. Use format='plain' for a readable string, 'json' for turn-by-turn structured data with timestamps, intent labels, and emotion scores.",
        inputSchema: zodToJsonSchema(GetTranscriptInput),
      },
    ],
  }));

  // Tool call dispatch.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    try {
      switch (name) {
        case "create_agent": {
          const args = CreateAgentInput.parse(rawArgs) as CreateAgentArgs;
          const result = await createAgent(client, args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }
        case "start_call": {
          const args = StartCallInput.parse(rawArgs) as StartCallArgs;
          const result = await startCall(client, args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }
        case "get_transcript": {
          const args = GetTranscriptInput.parse(rawArgs) as GetTranscriptArgs;
          const result = await getTranscript(client, args);
          return {
            content: [
              {
                type: "text",
                text:
                  args.format === "plain"
                    ? result.transcript_plain
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        }
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[nova-mcp] v${PACKAGE_VERSION} ready · base=${options.baseUrl}`,
  );
}

// Minimal Zod → JSON-Schema. MCP expects JSON Schema; we keep it inline so
// we don't pull a heavy dep just for this conversion.
function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>) {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = zodTypeToSchema(value as z.ZodTypeAny);
    if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
      required.push(key);
    }
  }
  return {
    type: "object" as const,
    properties,
    required,
    additionalProperties: false,
  };
}

function zodTypeToSchema(t: z.ZodTypeAny): Record<string, unknown> {
  const description = (t._def as { description?: string }).description;
  if (t instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    if (description) out.description = description;
    return out;
  }
  if (t instanceof z.ZodEnum) {
    const out: Record<string, unknown> = {
      type: "string",
      enum: t.options,
    };
    if (description) out.description = description;
    return out;
  }
  if (t instanceof z.ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    if (description) out.description = description;
    return out;
  }
  if (t instanceof z.ZodOptional) {
    return zodTypeToSchema(t.unwrap());
  }
  if (t instanceof z.ZodDefault) {
    const inner = zodTypeToSchema(t._def.innerType);
    inner.default = t._def.defaultValue();
    return inner;
  }
  return { type: "string", description };
}

main().catch((err) => {
  console.error("[nova-mcp] fatal:", err);
  process.exit(1);
});
