/**
 * Error types + human-friendly message mapping for the NOVA API.
 *
 * Every error surfaced to the calling LLM should be ACTIONABLE: say what
 * happened, why, and what to do next — never a bare status code.
 */

/** Structured error raised for any non-2xx NOVA API response. */
export class NovaApiError extends Error {
  constructor(
    message: string,
    /** HTTP status code, when the server responded at all. */
    public readonly status?: number,
    /** Raw `detail` payload from FastAPI, when present. */
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "NovaApiError";
  }
}

/** Raised when a tool requires auth but NOVA_API_KEY is not configured. */
export class NovaAuthMissingError extends Error {
  constructor(toolName: string) {
    super(
      `The "${toolName}" tool requires authentication, but NOVA_API_KEY is not set. ` +
        `Get a token with: curl -X POST <base>/auth/login -H 'content-type: application/json' ` +
        `-d '{"email":"you@example.com","password":"..."}' (the "access_token" field), ` +
        `then set NOVA_API_KEY in your MCP client config and restart the server. ` +
        `No account yet? Sign up at https://novalabs.ae.`,
    );
    this.name = "NovaAuthMissingError";
  }
}

/** Flatten FastAPI's `detail` (string | validation array | object) to text. */
export function formatDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI 422 validation errors: [{loc, msg, type}, ...]
    const parts = detail.map((item) => {
      if (item && typeof item === "object" && "msg" in item) {
        const loc = Array.isArray((item as { loc?: unknown }).loc)
          ? (item as { loc: unknown[] }).loc
              .filter((l) => l !== "body")
              .join(".") || "request"
          : "request";
        return `${loc}: ${String((item as { msg: unknown }).msg)}`;
      }
      return JSON.stringify(item);
    });
    return parts.join("; ");
  }
  return JSON.stringify(detail);
}

/** Map an HTTP failure to an actionable message. */
export function httpErrorMessage(
  status: number,
  statusText: string,
  detail: unknown,
  baseUrl: string,
): string {
  const reason = formatDetail(detail);
  switch (status) {
    case 401:
      return (
        `NOVA API rejected the request (401 Unauthorized)${reason ? `: ${reason}` : ""}. ` +
        `Your NOVA_API_KEY is missing, expired, or invalid. Get a fresh token via ` +
        `POST ${baseUrl}/auth/login and update NOVA_API_KEY in your MCP client config.`
      );
    case 402:
      return (
        `Usage limit reached (402 Payment Required)${reason ? `: ${reason}` : ""}. ` +
        `Check remaining minutes with the "get_usage" tool, or upgrade your plan at https://novalabs.ae.`
      );
    case 403:
      return (
        `Forbidden (403)${reason ? `: ${reason}` : ""}. ` +
        `The resource exists but belongs to a different NOVA account than your NOVA_API_KEY.`
      );
    case 404:
      return (
        `Not found (404)${reason ? `: ${reason}` : ""}. ` +
        `Note: call records are ephemeral (10-minute TTL) — a call_id from more than ` +
        `10 minutes ago will have expired.`
      );
    case 422:
      return (
        `NOVA API rejected the payload (422 Validation Error)${reason ? `: ${reason}` : ""}. ` +
        `Fix the listed fields and retry.`
      );
    case 429:
      return (
        `Rate limited (429)${reason ? `: ${reason}` : ""}. ` +
        `The API allows ~5 call submissions per minute per IP — wait ~60 seconds and retry.`
      );
    default:
      if (status >= 500) {
        return (
          `NOVA API server error (${status} ${statusText})${reason ? `: ${reason}` : ""}. ` +
          `This is on NOVA's side — retry shortly, or check ${baseUrl}/health.`
        );
      }
      return `NOVA API error (${status} ${statusText})${reason ? `: ${reason}` : ""}.`;
  }
}

/** Map low-level fetch/network failures to an actionable message. */
export function networkErrorMessage(
  err: unknown,
  baseUrl: string,
  timeoutMs: number,
): string {
  if (err instanceof Error && err.name === "AbortError") {
    return (
      `Request to ${baseUrl} timed out after ${timeoutMs}ms. ` +
      `The API may be cold-starting or slow — retry, or raise NOVA_TIMEOUT_MS.`
    );
  }
  const cause =
    err instanceof Error
      ? ((err as { cause?: { code?: string } }).cause?.code ?? "")
      : "";
  const codeHint = cause ? ` (${cause})` : "";
  return (
    `Could not reach the NOVA API at ${baseUrl}${codeHint}. ` +
    `Check your network connection and that NOVA_API_URL is correct ` +
    `(default: https://api.novalabs.ae).`
  );
}
