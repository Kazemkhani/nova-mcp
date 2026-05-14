/**
 * Thin HTTP client for the NOVA Labs API.
 *
 * Single source of truth for how MCP tools talk to api.novalabs.ae — keeps the
 * tool dispatcher in index.ts free of fetch / serialisation noise.
 */

export interface NovaClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export class NovaClient {
  constructor(private readonly opts: NovaClientOptions) {}

  async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
          "user-agent": "nova-mcp/0.1.0 (+https://novalabs.ae)",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `NOVA API ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `NOVA API request timed out after ${this.opts.timeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------- tool-level wrappers (typed surface for index.ts) ----------

export interface CreateAgentInput {
  name: string;
  url: string;
  goal: "book_meeting" | "qualify_lead" | "close_sale" | "collect_info";
  voice: "sara_en" | "layla_ar" | "khalid_en" | "noor_en";
  language: "en" | "ar" | "hi" | "ur";
}

export interface CreateAgentResult {
  agent_id: string;
  name: string;
  status: "ready" | "indexing" | "error";
  context_summary: string;
  dashboard_url: string;
}

export async function createAgent(
  client: NovaClient,
  input: CreateAgentInput,
): Promise<CreateAgentResult> {
  return client.request<CreateAgentResult>("POST", "/api/agents", input);
}

export interface StartCallInput {
  agent_id: string;
  phone_number: string;
  lead_name: string;
  lead_context?: string;
}

export interface StartCallResult {
  call_id: string;
  status: "queued" | "ringing" | "in_progress";
  estimated_start_seconds: number;
  recording_url: string | null;
}

export async function startCall(
  client: NovaClient,
  input: StartCallInput,
): Promise<StartCallResult> {
  return client.request<StartCallResult>("POST", "/api/calls", input);
}

export interface GetTranscriptInput {
  call_id: string;
  format: "plain" | "json";
}

export interface TranscriptTurn {
  role: "agent" | "lead";
  text: string;
  start_ms: number;
  end_ms: number;
  intent?: string;
  emotion?: string;
}

export interface GetTranscriptResult {
  call_id: string;
  status:
    | "queued"
    | "ringing"
    | "in_progress"
    | "completed"
    | "failed"
    | "voicemail";
  outcome:
    | "meeting_booked"
    | "qualified"
    | "not_interested"
    | "callback"
    | "no_answer"
    | null;
  duration_seconds: number;
  transcript_plain: string;
  transcript_turns: TranscriptTurn[];
  recording_url: string | null;
  quality_score: number | null;
}

export async function getTranscript(
  client: NovaClient,
  input: GetTranscriptInput,
): Promise<GetTranscriptResult> {
  return client.request<GetTranscriptResult>(
    "GET",
    `/api/calls/${encodeURIComponent(input.call_id)}/transcript`,
  );
}
