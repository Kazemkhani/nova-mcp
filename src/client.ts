/**
 * HTTP client for the NOVA Labs API.
 *
 * Single source of truth for transport concerns: auth header injection,
 * timeouts, bounded retries for idempotent requests, and mapping every
 * failure mode to an actionable error message.
 */

import type { NovaConfig } from "./config.js";
import {
  NovaApiError,
  NovaAuthMissingError,
  httpErrorMessage,
  networkErrorMessage,
} from "./errors.js";
import { VERSION } from "./version.js";

export const USER_AGENT =
  `nova-mcp/${VERSION} (+https://github.com/Kazemkhani/nova-mcp)`;

/** Statuses worth one retry on idempotent (GET) requests. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_GET_RETRIES = 2;
const RETRY_DELAY_MS = 300;

export interface RequestOptions {
  /** JSON body for POST/DELETE requests. */
  body?: unknown;
  /**
   * Auth mode:
   *  - "none": never send Authorization (public endpoints like /health)
   *  - "optional": send Authorization when a key is configured
   *  - "required": throw a setup-guidance error when no key is configured
   */
  auth?: "none" | "optional" | "required";
  /** Tool name used in the auth-missing error message. */
  toolName?: string;
}

export class NovaClient {
  constructor(
    private readonly config: NovaConfig,
    /** Injectable for tests; defaults to global fetch. */
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get hasApiKey(): boolean {
    return Boolean(this.config.apiKey);
  }

  async get<T>(
    path: string,
    opts: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("GET", path, opts);
  }

  async post<T>(
    path: string,
    body: unknown,
    opts: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }

  async delete<T>(
    path: string,
    opts: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const auth = opts.auth ?? "optional";
    if (auth === "required" && !this.config.apiKey) {
      throw new NovaAuthMissingError(opts.toolName ?? "this");
    }

    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": USER_AGENT,
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (auth !== "none" && this.config.apiKey) {
      headers["authorization"] = `Bearer ${this.config.apiKey}`;
    }

    // Only idempotent GETs are retried; POST /calls must never double-dial.
    const attempts = method === "GET" ? 1 + MAX_GET_RETRIES : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: controller.signal,
        });

        if (res.ok) {
          if (res.status === 204) return undefined as T;
          const text = await res.text();
          if (!text) return undefined as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new NovaApiError(
              `NOVA API returned a non-JSON 2xx response from ${path}. ` +
                `If NOVA_API_URL points at a proxy or the wrong host, fix it ` +
                `(default: https://api.novalabs.ae).`,
              res.status,
            );
          }
        }

        const detail = await readDetail(res);
        const error = new NovaApiError(
          httpErrorMessage(
            res.status,
            res.statusText,
            detail,
            this.config.baseUrl,
          ),
          res.status,
          detail,
        );
        if (
          method === "GET" &&
          RETRYABLE_STATUSES.has(res.status) &&
          attempt < attempts
        ) {
          lastError = error;
          await this.sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw error;
      } catch (err) {
        if (
          err instanceof NovaApiError ||
          err instanceof NovaAuthMissingError
        ) {
          throw err;
        }
        // Network-level failure (DNS, refused, reset, abort/timeout).
        const wrapped = new NovaApiError(
          networkErrorMessage(err, this.config.baseUrl, this.config.timeoutMs),
        );
        if (method === "GET" && attempt < attempts) {
          lastError = wrapped;
          await this.sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        throw wrapped;
      } finally {
        clearTimeout(timer);
      }
    }

    // Unreachable in practice; defensive for the type checker.
    throw lastError instanceof Error
      ? lastError
      : new NovaApiError(
          `Request to ${path} failed after ${attempts} attempts.`,
        );
  }
}

async function readDetail(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      return (parsed as { detail: unknown }).detail;
    }
    return parsed;
  } catch {
    // Truncate HTML error pages etc. so messages stay readable.
    return text.slice(0, 300);
  }
}
