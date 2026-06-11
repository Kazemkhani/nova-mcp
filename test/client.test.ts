import { describe, expect, it, vi } from "vitest";
import { NovaClient } from "../src/client.js";
import type { NovaConfig } from "../src/config.js";
import { NovaApiError, NovaAuthMissingError } from "../src/errors.js";

const BASE: NovaConfig = {
  baseUrl: "https://api.test.nova",
  apiKey: "test-token",
  timeoutMs: 1000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Client whose sleep is a no-op so retry tests run instantly. */
function makeClient(config: NovaConfig, fetchImpl: typeof fetch): NovaClient {
  return new NovaClient(config, fetchImpl, () => Promise.resolve());
}

/** Await a promise that MUST reject; return the rejection as an Error. */
async function expectError(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected promise to reject, but it resolved");
}

describe("NovaClient", () => {
  it("performs a GET and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.get("/health")).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test.nova/health");
    expect(init.method).toBe("GET");
  });

  it("sends Authorization header when a key is configured (auth=optional)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await client.get("/calls/abc");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-token",
    );
  });

  it("omits Authorization for auth=none even when a key is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await client.get("/health", { auth: "none" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("throws a setup-guidance error for auth=required without a key (no HTTP call)", async () => {
    const fetchMock = vi.fn();
    const client = makeClient(
      { ...BASE, apiKey: undefined },
      fetchMock as unknown as typeof fetch,
    );
    await expect(
      client.get("/billing/usage", { auth: "required", toolName: "get_usage" }),
    ).rejects.toThrow(NovaAuthMissingError);
    await expect(
      client.get("/billing/usage", { auth: "required", toolName: "get_usage" }),
    ).rejects.toThrow(/NOVA_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 401 to an actionable NOVA_API_KEY message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "Invalid token" }, 401));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    const err = await expectError(client.get("/auth/me"));
    expect(err).toBeInstanceOf(NovaApiError);
    expect((err as NovaApiError).status).toBe(401);
    expect((err as Error).message).toMatch(/NOVA_API_KEY/);
    expect((err as Error).message).toMatch(/auth\/login/);
  });

  it("maps 402 to a usage-limit message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: "Trial minutes exhausted" }, 402),
      );
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.post("/calls", {})).rejects.toThrow(
      /Trial minutes exhausted/,
    );
    await expect(client.post("/calls", {})).rejects.toThrow(/get_usage/);
  });

  it("maps 404 with the ephemeral-TTL hint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: "Call not found or expired" }, 404),
      );
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.get("/calls/x")).rejects.toThrow(/10-minute TTL/);
  });

  it("flattens FastAPI 422 validation arrays", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: [
            {
              loc: ["body", "owner_email"],
              msg: "field required",
              type: "missing",
            },
            { loc: ["body", "goal"], msg: "invalid enum member", type: "enum" },
          ],
        },
        422,
      ),
    );
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    const err = await expectError(client.post("/calls", {}));
    expect(err.message).toMatch(/owner_email: field required/);
    expect(err.message).toMatch(/goal: invalid enum member/);
  });

  it("maps 429 to a rate-limit message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "Rate limit exceeded" }, 429));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.post("/calls", {})).rejects.toThrow(/Rate limited/);
  });

  it("retries GETs on 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: "warming up" }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.get("/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry POSTs (no double-dial)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "boom" }, 503));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.post("/calls", {})).rejects.toThrow(/server error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry GETs on 4xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "nope" }, 404));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.get("/calls/x")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to an actionable message and retries GETs", async () => {
    const netErr = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.get("/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clear message when the network is fully down", async () => {
    const netErr = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    const fetchMock = vi.fn().mockRejectedValue(netErr);
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    const err = await expectError(client.get("/health"));
    expect(err.message).toMatch(/Could not reach/);
    expect(err.message).toMatch(/ENOTFOUND/);
    expect(err.message).toMatch(/NOVA_API_URL/);
  });

  it("maps timeouts (AbortError) to a NOVA_TIMEOUT_MS hint", async () => {
    const abortErr = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    const err = await expectError(client.post("/calls", {}));
    expect(err.message).toMatch(/timed out after 1000ms/);
    expect(err.message).toMatch(/NOVA_TIMEOUT_MS/);
  });

  it("handles 204 / empty bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.delete("/v1/webhooks/x")).resolves.toBeUndefined();
  });

  it("errors clearly on non-JSON 2xx responses (wrong host/proxy)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("<html>hi</html>", { status: 200 }));
    const client = makeClient(BASE, fetchMock as unknown as typeof fetch);
    await expect(client.get("/health")).rejects.toThrow(/non-JSON/);
  });
});
