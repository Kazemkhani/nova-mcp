/**
 * Environment-driven configuration for the NOVA MCP server.
 *
 * No secrets are ever hardcoded — everything comes from the environment:
 *
 *   NOVA_API_KEY    — bearer token for api.novalabs.ae (optional; some tools
 *                     work unauthenticated, others will return a helpful
 *                     error explaining how to get a token).
 *   NOVA_API_URL    — API base URL. Defaults to https://api.novalabs.ae.
 *                     (NOVA_API_BASE is accepted as a legacy alias.)
 *   NOVA_TIMEOUT_MS — per-request timeout in milliseconds. Default 30000.
 */

export const DEFAULT_BASE_URL = "https://api.novalabs.ae";
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface NovaConfig {
  /** API base URL, normalised without a trailing slash. */
  baseUrl: string;
  /** Bearer token. Undefined means "unauthenticated" (allowed). */
  apiKey: string | undefined;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/** Read config from an environment map (defaults to process.env). */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): NovaConfig {
  const rawBase = env.NOVA_API_URL ?? env.NOVA_API_BASE ?? DEFAULT_BASE_URL;
  const baseUrl = normaliseBaseUrl(rawBase);

  const apiKey = env.NOVA_API_KEY?.trim() || undefined;

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (env.NOVA_TIMEOUT_MS !== undefined) {
    const parsed = Number(env.NOVA_TIMEOUT_MS);
    if (Number.isFinite(parsed) && parsed > 0) {
      timeoutMs = Math.floor(parsed);
    } else {
      throw new Error(
        `NOVA_TIMEOUT_MS must be a positive number of milliseconds, got "${env.NOVA_TIMEOUT_MS}".`,
      );
    }
  }

  return { baseUrl, apiKey, timeoutMs };
}

function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `NOVA_API_URL is not a valid URL: "${raw}". Expected something like ${DEFAULT_BASE_URL}.`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `NOVA_API_URL must be http(s), got "${parsed.protocol}//". Expected something like ${DEFAULT_BASE_URL}.`,
    );
  }
  return trimmed;
}
