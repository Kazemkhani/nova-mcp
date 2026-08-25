import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_AGENT } from "../src/client.js";
import { SERVER_VERSION } from "../src/server.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("release version", () => {
  it("keeps package, MCP handshake, CLI, and HTTP identity aligned", () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(USER_AGENT).toContain(`nova-mcp/${packageJson.version}`);
  });
});
