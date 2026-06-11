/**
 * TypeScript mirrors of the NOVA API's Pydantic response models.
 *
 * Source of truth: apps/api/src/api/main.py + routers in the NOVA monorepo.
 * Keep field names snake_case to match the wire format exactly.
 */

// ---------------------------------------------------------------------------
// Enums (mirrors shared/schemas.py)
// ---------------------------------------------------------------------------

export type CallGoal =
  | "book_meeting"
  | "qualify_interest"
  | "collect_info"
  | "close_sale";

export type CallLanguage = "en" | "ar-AE";

export type CallStatus = "pending" | "in_progress" | "completed" | "failed";

export const WEBHOOK_EVENT_TYPES = [
  "call.started",
  "call.ended",
  "call.transcribed",
  "call.scored",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// POST /calls
// ---------------------------------------------------------------------------

export interface Lead {
  phone: string;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  title?: string | null;
}

export interface CallRequestBody {
  owner_email: string;
  leads: Lead[];
  product: string;
  website_url?: string | null;
  context?: string;
  goal: CallGoal;
  language?: CallLanguage;
  booking_link?: string | null;
  payment_link?: string | null;
  pricing_summary?: string | null;
  urgency_hook?: string | null;
  goal_criteria?: string | null;
  consent: boolean;
  idempotency_key?: string | null;
}

export interface LeadCallResult {
  call_id: string;
  context_id: string;
  phone: string;
  lead_name: string | null;
  status: CallStatus;
  expires_in_seconds: number;
  message: string;
}

export interface BatchCallResponse {
  calls: LeadCallResult[];
  total: number;
  dispatched: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// GET /calls/{call_id}
// ---------------------------------------------------------------------------

export interface CallStatusResponse {
  call_id: string;
  status: CallStatus;
  phone: string;
  sms_sent: boolean;
  error: string | null;
  expires_in_seconds: number;
}

// ---------------------------------------------------------------------------
// GET /contexts/{context_id} — the full per-call agent brief
// ---------------------------------------------------------------------------

export interface CallBrief {
  id: string;
  created_at: string;
  owner_email: string;
  phone: string;
  name: string | null;
  product: string;
  goal: CallGoal;
  language: CallLanguage;
  agent_instructions: string;
  opening_line: string;
  qualification_questions: string[];
  objection_handlers: Record<string, string>;
  closing_script: string;
  product_facts: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// GET /api/calls/{call_id}/quality
// ---------------------------------------------------------------------------

export interface CallQualityResponse {
  call_id: string;
  scored_at: string | null;
  score: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  timestamp: string;
  active_calls: number;
  ttl_seconds: number;
}

export interface DeepHealthResponse {
  status: string;
  timestamp: string;
  checks: Record<
    string,
    { status: string; latency_ms?: number; reason?: string }
  >;
}

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

export interface UserResponse {
  id: string;
  email: string;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  trial_active: boolean;
  trial_minutes_remaining: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /billing/usage
// ---------------------------------------------------------------------------

export interface UsageResponse {
  plan: string | null;
  status: string;
  minutes_used: number;
  minutes_limit: number | null;
  minutes_remaining: number | null;
  period_start: string | null;
  period_end: string | null;
  trial_ends_at: string | null;
}

// ---------------------------------------------------------------------------
// /v1/webhooks
// ---------------------------------------------------------------------------

export interface WebhookCreateResponse {
  id: string;
  url: string;
  events: WebhookEventType[];
  /** Raw signing secret — returned exactly once at creation time. */
  secret: string;
  is_active: boolean;
  created_at: string;
}

export interface WebhookSummary {
  id: string;
  url: string;
  events: WebhookEventType[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookTestResponse {
  delivery_id: string;
  event_type: string;
  message: string;
}

// ---------------------------------------------------------------------------
// POST /token — LiveKit browser-demo token
// ---------------------------------------------------------------------------

export interface TokenResponse {
  server_url: string;
  participant_token: string;
  room_name: string;
}
