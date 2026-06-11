#!/usr/bin/env node
/**
 * nova-mcp — official MCP server for NOVA Labs (https://novalabs.ae).
 *
 * Exposes the NOVA voice-agent API (api.novalabs.ae) as MCP tools over
 * stdio: place AI voice calls, track them, read quality scores, manage
 * webhooks, and join demo-mode calls from the browser.
 *
 * Configuration (environment variables only — never hardcode secrets):
 *   NOVA_API_KEY    — bearer token (optional; required for account tools)
 *   NOVA_API_URL    — API base URL (default https://api.novalabs.ae)
 *   NOVA_TIMEOUT_MS — request timeout in ms (default 30000)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { SERVER_VERSION, buildServer } from "./server.js";

function printHelp(): void {
  // CLI output (not MCP traffic) — stdout is fine here since we exit after.
  console.log(`nova-mcp v${SERVER_VERSION} — MCP server for the NOVA Labs voice-agent API

Usage: nova-mcp [--help] [--version]

The server speaks MCP over stdio; run it from an MCP client (Claude Desktop,
Claude Code, Cursor), not directly in a terminal.

Environment:
  NOVA_API_KEY     Bearer token for api.novalabs.ae (optional; account tools need it)
  NOVA_API_URL     API base URL (default: https://api.novalabs.ae)
  NOVA_TIMEOUT_MS  Request timeout in ms (default: 30000)

Docs: https://github.com/Kazemkhani/nova-mcp`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(SERVER_VERSION);
    return;
  }

  const config = loadConfig();
  const server = buildServer(config);

  // All diagnostics go to stderr — stdout is reserved for MCP JSON-RPC.
  if (!config.apiKey) {
    console.error(
      "[nova-mcp] NOVA_API_KEY not set — public tools (health_check, place_calls, " +
        "get_call, …) still work; account tools (whoami, get_usage, webhooks) will " +
        "explain how to authenticate.",
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[nova-mcp] v${SERVER_VERSION} ready · api=${config.baseUrl}`);
}

main().catch((err: unknown) => {
  console.error("[nova-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
