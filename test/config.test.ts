import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  loadConfig,
} from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("reads NOVA_API_KEY and trims whitespace", () => {
    expect(loadConfig({ NOVA_API_KEY: "  tok123  " }).apiKey).toBe("tok123");
  });

  it("treats empty NOVA_API_KEY as unset", () => {
    expect(loadConfig({ NOVA_API_KEY: "   " }).apiKey).toBeUndefined();
  });

  it("prefers NOVA_API_URL over legacy NOVA_API_BASE", () => {
    const cfg = loadConfig({
      NOVA_API_URL: "https://staging.example.com",
      NOVA_API_BASE: "https://legacy.example.com",
    });
    expect(cfg.baseUrl).toBe("https://staging.example.com");
  });

  it("falls back to legacy NOVA_API_BASE", () => {
    expect(
      loadConfig({ NOVA_API_BASE: "https://legacy.example.com" }).baseUrl,
    ).toBe("https://legacy.example.com");
  });

  it("strips trailing slashes from the base URL", () => {
    expect(
      loadConfig({ NOVA_API_URL: "https://api.example.com///" }).baseUrl,
    ).toBe("https://api.example.com");
  });

  it("rejects malformed base URLs", () => {
    expect(() => loadConfig({ NOVA_API_URL: "not a url" })).toThrow(
      /not a valid URL/,
    );
  });

  it("rejects non-http(s) base URLs", () => {
    expect(() => loadConfig({ NOVA_API_URL: "ftp://api.example.com" })).toThrow(
      /http/,
    );
  });

  it("parses NOVA_TIMEOUT_MS", () => {
    expect(loadConfig({ NOVA_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5000);
  });

  it("rejects invalid NOVA_TIMEOUT_MS", () => {
    expect(() => loadConfig({ NOVA_TIMEOUT_MS: "soon" })).toThrow(
      /NOVA_TIMEOUT_MS/,
    );
    expect(() => loadConfig({ NOVA_TIMEOUT_MS: "-1" })).toThrow(
      /NOVA_TIMEOUT_MS/,
    );
  });
});
