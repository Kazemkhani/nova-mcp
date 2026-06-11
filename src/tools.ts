/**
 * MCP tool definitions for the NOVA Labs API.
 *
 * Every tool maps 1:1 to a real endpoint on api.novalabs.ae (FastAPI).
 * Descriptions are written for the calling LLM: they say what the tool
 * does, what it returns, and any operational caveats (demo mode, TTLs).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { NovaClient } from "./client.js";
import type {
  BatchCallResponse,
  CallBrief,
  CallQualityResponse,
  CallRequestBody,
  CallStatusResponse,
  DeepHealthResponse,
  HealthResponse,
  TokenResponse,
  UsageResponse,
  UserResponse,
  WebhookCreateResponse,
  WebhookSummary,
  WebhookTestResponse,
} from "./types.js";
import { WEBHOOK_EVENT_TYPES } from "./types.js";

/** Total number of tools registered — asserted by tests and the smoke script. */
export const TOOL_COUNT = 12;

const E164_REGEX = /^\+[1-9]\d{6,14}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEMO_MODE_NOTE =
  "NOTE: NOVA currently runs in DEMO MODE — no real phone (PSTN) dial is placed. " +
  "The AI voice agent is dispatched into a LiveKit room named call-<context_id>; " +
  "use the get_demo_token tool with the returned context_id to join the conversation " +
  "from a browser. The request/response contract is identical to production dialing.";

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const phoneSchema = z
  .string()
  .regex(
    E164_REGEX,
    "Phone must be E.164 format with a leading +, e.g. +971501234567",
  )
  .describe("Phone number in E.164 format (e.g. +971501234567).");

const callIdSchema = z
  .string()
  .regex(UUID_REGEX, "call_id must be a UUID")
  .describe("Call ID (UUID) returned by place_calls.");

const leadSchema = z.object({
  phone: phoneSchema,
  name: z
    .string()
    .max(120)
    .optional()
    .describe("Lead's name, used for personalisation."),
  company: z.string().max(200).optional().describe("Lead's company."),
  email: z
    .string()
    .email()
    .optional()
    .describe("Lead's email (pre-known, not collected on call)."),
  title: z.string().max(120).optional().describe("Lead's job title."),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResult(data: unknown, preamble?: string): CallToolResult {
  const body = JSON.stringify(data, null, 2);
  return {
    content: [
      { type: "text", text: preamble ? `${preamble}\n\n${body}` : body },
    ],
  };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wrap a handler so any thrown error becomes a proper MCP tool error. */
function safe<A>(
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      return errorResult(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer, client: NovaClient): void {
  // ---- 1. health_check ----------------------------------------------------
  server.registerTool(
    "health_check",
    {
      title: "NOVA API health check",
      description:
        "Check that the NOVA API is up. Returns status, timestamp and the number of " +
        "active calls. Set deep=true to also probe critical dependencies (database, " +
        "LiveKit) — deep returns per-dependency latency and a degraded verdict on failure. " +
        "No authentication required. Use this first when other tools fail.",
      inputSchema: {
        deep: z
          .boolean()
          .default(false)
          .describe(
            "true = probe DB + LiveKit dependencies (slower); false = shallow check.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ deep }) => {
      const data = deep
        ? await client.get<DeepHealthResponse>("/health/deep", { auth: "none" })
        : await client.get<HealthResponse>("/health", { auth: "none" });
      return jsonResult(data);
    }),
  );

  // ---- 2. whoami ----------------------------------------------------------
  server.registerTool(
    "whoami",
    {
      title: "Current NOVA account",
      description:
        "Return the NOVA account associated with the configured NOVA_API_KEY: email, " +
        "verification status, trial state and remaining trial minutes. Use this to " +
        "verify that authentication is set up correctly.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async () => {
      const data = await client.get<UserResponse>("/auth/me", {
        auth: "required",
        toolName: "whoami",
      });
      return jsonResult(data);
    }),
  );

  // ---- 3. place_calls -----------------------------------------------------
  server.registerTool(
    "place_calls",
    {
      title: "Place outbound AI voice calls",
      description:
        "Create and dispatch AI voice-agent calls to 1-5 leads in a single batch. " +
        "NOVA builds a per-lead call brief (system prompt, opening line, objection " +
        "handlers) from your product description and optional website, then dispatches " +
        "one agent per lead. Returns a call_id + context_id per lead. " +
        "Consent is mandatory: only set consent=true if the lead list has genuinely " +
        "agreed to be contacted. Works without authentication today, but authenticated " +
        "calls are metered against your plan and unlock webhooks + quality scores. " +
        DEMO_MODE_NOTE,
      inputSchema: {
        owner_email: z
          .string()
          .email()
          .describe(
            "Business owner's email — call results are delivered here.",
          ),
        product: z
          .string()
          .min(1)
          .max(2000)
          .describe("What you are selling, in one or two sentences."),
        leads: z
          .array(leadSchema)
          .min(1)
          .max(5)
          .describe(
            "1-5 leads to call. Each needs a unique E.164 phone number.",
          ),
        goal: z
          .enum([
            "book_meeting",
            "qualify_interest",
            "collect_info",
            "close_sale",
          ])
          .describe(
            "What the call should accomplish. book_meeting requires booking_link; " +
              "close_sale requires payment_link.",
          ),
        language: z
          .enum(["en", "ar-AE"])
          .default("en")
          .describe("Spoken language: English or Gulf Arabic (ar-AE)."),
        website_url: z
          .string()
          .url()
          .optional()
          .describe("Optional website to scrape for product context."),
        context: z
          .string()
          .max(5000)
          .optional()
          .describe("Optional free-text product/offer context for the agent."),
        booking_link: z
          .string()
          .url()
          .optional()
          .describe("Calendar/booking URL — required when goal=book_meeting."),
        payment_link: z
          .string()
          .url()
          .optional()
          .describe("Payment URL — required when goal=close_sale."),
        pricing_summary: z
          .string()
          .max(1000)
          .optional()
          .describe("Exact pricing the agent may quote (close_sale)."),
        urgency_hook: z
          .string()
          .max(500)
          .optional()
          .describe("Limited-time offer / urgency line (close_sale)."),
        goal_criteria: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Qualification criteria or the info to collect (qualify_interest / collect_info).",
          ),
        consent: z
          .literal(true)
          .describe(
            "Must be exactly true: confirms the leads have consented to be contacted " +
              "and recorded. Calls cannot be placed without consent.",
          ),
        idempotency_key: z
          .string()
          .max(128)
          .optional()
          .describe(
            "Optional client-supplied key to guard against duplicate submissions.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    safe(async (args) => {
      // Cross-field validation, mirrored from the API so the LLM gets an
      // instant, precise error instead of a round-trip 400.
      if (args.goal === "book_meeting" && !args.booking_link) {
        return errorResult(
          new Error(
            'goal "book_meeting" requires booking_link (a calendar URL the agent offers the lead).',
          ),
        );
      }
      if (args.goal === "close_sale" && !args.payment_link) {
        return errorResult(
          new Error(
            'goal "close_sale" requires payment_link (a checkout URL the agent sends the lead).',
          ),
        );
      }
      const phones = args.leads.map((lead) => lead.phone);
      const dupes = phones.filter((p, i) => phones.indexOf(p) !== i);
      if (dupes.length > 0) {
        return errorResult(
          new Error(
            `Duplicate phone number(s) in leads: ${[...new Set(dupes)].join(", ")}.`,
          ),
        );
      }

      const body: CallRequestBody = {
        owner_email: args.owner_email,
        product: args.product,
        leads: args.leads,
        goal: args.goal,
        language: args.language,
        website_url: args.website_url ?? null,
        context: args.context ?? "",
        booking_link: args.booking_link ?? null,
        payment_link: args.payment_link ?? null,
        pricing_summary: args.pricing_summary ?? null,
        urgency_hook: args.urgency_hook ?? null,
        goal_criteria: args.goal_criteria ?? null,
        consent: true,
        idempotency_key: args.idempotency_key ?? null,
      };

      const data = await client.post<BatchCallResponse>("/calls", body, {
        auth: "optional",
        toolName: "place_calls",
      });
      return jsonResult(
        data,
        `Dispatched ${data.dispatched}/${data.total} call(s)` +
          (data.failed > 0 ? ` (${data.failed} failed)` : "") +
          ". Track each with get_call(call_id); call records expire after 10 minutes. " +
          "Demo mode: join the conversation via get_demo_token(context_id).",
      );
    }),
  );

  // ---- 4. get_call ----------------------------------------------------------
  server.registerTool(
    "get_call",
    {
      title: "Get call status",
      description:
        "Fetch the live status of a call by call_id: pending, in_progress, completed " +
        "or failed, plus any error message. Call records are EPHEMERAL with a " +
        "10-minute TTL — poll while the call runs; a 404 usually means the record expired. " +
        "Full results (transcript + outcome) are emailed to owner_email after the call.",
      inputSchema: { call_id: callIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ call_id }) => {
      const data = await client.get<CallStatusResponse>(
        `/calls/${encodeURIComponent(call_id)}`,
        { auth: "optional" },
      );
      return jsonResult(data);
    }),
  );

  // ---- 5. get_call_brief ------------------------------------------------------
  server.registerTool(
    "get_call_brief",
    {
      title: "Get the agent's call brief",
      description:
        "Fetch the full AI-generated brief for a call by context_id (returned by " +
        "place_calls): system instructions, opening line, qualification questions, " +
        "objection handlers, closing script and the approved product facts. Useful for " +
        "reviewing exactly what the agent was told to say. Same 10-minute TTL as calls.",
      inputSchema: {
        context_id: z
          .string()
          .regex(UUID_REGEX, "context_id must be a UUID")
          .describe("Context ID (UUID) returned by place_calls."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ context_id }) => {
      const data = await client.get<CallBrief>(
        `/contexts/${encodeURIComponent(context_id)}`,
        { auth: "optional" },
      );
      return jsonResult(data);
    }),
  );

  // ---- 6. get_call_quality ---------------------------------------------------
  server.registerTool(
    "get_call_quality",
    {
      title: "Get call quality score",
      description:
        "Fetch the LLM-as-judge quality score for a completed call (5-dimension rubric). " +
        "Scoring runs asynchronously after the call ends: a response with score=null " +
        "means 'not scored yet' — retry in a minute. 404 means the call does not exist; " +
        "403 means it belongs to another account.",
      inputSchema: { call_id: callIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ call_id }) => {
      const data = await client.get<CallQualityResponse>(
        `/api/calls/${encodeURIComponent(call_id)}/quality`,
        { auth: "optional" },
      );
      return jsonResult(
        data,
        data.score === null
          ? "Call exists but has not been scored yet (scoring is async — retry shortly)."
          : undefined,
      );
    }),
  );

  // ---- 7. get_usage ----------------------------------------------------------
  server.registerTool(
    "get_usage",
    {
      title: "Get plan usage",
      description:
        "Return the authenticated account's current plan, subscription status, minutes " +
        "used / remaining for the billing period, and trial expiry. Check this before " +
        "placing large batches to avoid 402 Payment Required errors.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async () => {
      const data = await client.get<UsageResponse>("/billing/usage", {
        auth: "required",
        toolName: "get_usage",
      });
      return jsonResult(data);
    }),
  );

  // ---- 8. list_webhooks --------------------------------------------------------
  server.registerTool(
    "list_webhooks",
    {
      title: "List webhooks",
      description:
        "List the authenticated account's registered webhooks (URL, subscribed events, " +
        "active flag). Signing secrets are never returned here — they are shown once at " +
        "creation time only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async () => {
      const data = await client.get<WebhookSummary[]>("/v1/webhooks", {
        auth: "required",
        toolName: "list_webhooks",
      });
      return jsonResult(data);
    }),
  );

  // ---- 9. create_webhook ---------------------------------------------------------
  server.registerTool(
    "create_webhook",
    {
      title: "Register a webhook",
      description:
        "Register an HTTPS endpoint to receive call lifecycle events " +
        `(${WEBHOOK_EVENT_TYPES.join(", ")}). The response includes the HMAC signing ` +
        "secret EXACTLY ONCE — store it immediately; it cannot be retrieved later. " +
        "Requires authentication.",
      inputSchema: {
        url: z
          .string()
          .url()
          .startsWith("https://", "Webhook URLs must be HTTPS")
          .describe("HTTPS URL NOVA will POST event payloads to."),
        events: z
          .array(z.enum(WEBHOOK_EVENT_TYPES))
          .min(1)
          .describe("Event types to subscribe to."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    safe(async ({ url, events }) => {
      const data = await client.post<WebhookCreateResponse>(
        "/v1/webhooks",
        { url, events },
        { auth: "required", toolName: "create_webhook" },
      );
      return jsonResult(
        data,
        "IMPORTANT: the `secret` below is shown exactly once — save it now to verify " +
          "webhook signatures.",
      );
    }),
  );

  // ---- 10. delete_webhook ----------------------------------------------------------
  server.registerTool(
    "delete_webhook",
    {
      title: "Delete a webhook",
      description:
        "Deactivate a webhook by ID (soft delete — deliveries stop immediately). " +
        "Requires authentication and ownership of the webhook.",
      inputSchema: {
        webhook_id: z
          .string()
          .regex(UUID_REGEX, "webhook_id must be a UUID")
          .describe("Webhook ID (UUID) from list_webhooks."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    safe(async ({ webhook_id }) => {
      await client.delete<void>(
        `/v1/webhooks/${encodeURIComponent(webhook_id)}`,
        {
          auth: "required",
          toolName: "delete_webhook",
        },
      );
      return jsonResult({ deleted: true, webhook_id });
    }),
  );

  // ---- 11. test_webhook -------------------------------------------------------------
  server.registerTool(
    "test_webhook",
    {
      title: "Send a test webhook event",
      description:
        "Send a fake call.started payload to a registered webhook so you can verify " +
        "your receiver and signature validation end-to-end. Requires authentication.",
      inputSchema: {
        webhook_id: z
          .string()
          .regex(UUID_REGEX, "webhook_id must be a UUID")
          .describe("Webhook ID (UUID) from list_webhooks."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    safe(async ({ webhook_id }) => {
      const data = await client.post<WebhookTestResponse>(
        `/v1/webhooks/${encodeURIComponent(webhook_id)}/test`,
        undefined,
        { auth: "required", toolName: "test_webhook" },
      );
      return jsonResult(data);
    }),
  );

  // ---- 12. get_demo_token --------------------------------------------------------------
  server.registerTool(
    "get_demo_token",
    {
      title: "Get a browser-demo join token",
      description:
        "Generate a LiveKit participant token so a human can join a live call room from " +
        "the browser and talk to the AI agent — this is how DEMO MODE calls are " +
        "experienced (no real phone dial). Pass the context_id returned by place_calls " +
        "(the room is call-<context_id>), or an explicit room_name. Returns server_url + " +
        "participant_token for a LiveKit web client. Tokens expire after 10 minutes.",
      inputSchema: {
        context_id: z
          .string()
          .regex(UUID_REGEX, "context_id must be a UUID")
          .optional()
          .describe(
            "Context ID from place_calls — resolves to room call-<context_id>.",
          ),
        room_name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Explicit LiveKit room name (overrides context_id)."),
        participant_name: z
          .string()
          .min(1)
          .max(80)
          .default("Demo Caller")
          .describe("Display name for the browser participant."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    safe(async ({ context_id, room_name, participant_name }) => {
      const room = room_name ?? (context_id ? `call-${context_id}` : undefined);
      if (!room) {
        return errorResult(
          new Error(
            "Provide either context_id (from place_calls) or an explicit room_name.",
          ),
        );
      }
      const data = await client.post<TokenResponse>(
        "/token",
        { room_name: room, participant_name },
        { auth: "optional" },
      );
      return jsonResult(data);
    }),
  );
}
