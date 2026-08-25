/**
 * Server factory — builds a fully-configured McpServer instance.
 *
 * Kept separate from the stdio entrypoint (index.ts) so tests can connect
 * it to an in-memory transport without spawning a process.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NovaClient } from "./client.js";
import type { NovaConfig } from "./config.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "nova-mcp";
export const SERVER_VERSION = VERSION;

export interface BuildServerOptions {
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export function buildServer(
  config: NovaConfig,
  opts: BuildServerOptions = {},
): McpServer {
  const client = new NovaClient(config, opts.fetchImpl ?? fetch);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "NOVA Labs voice-agent tools. Typical flow: health_check → place_calls " +
        "(1-5 leads, consent required) → get_call to poll status → get_call_quality " +
        "once completed. NOVA currently runs in demo mode: no real phone is dialled; " +
        "use get_demo_token to join the agent's room from a browser. Authenticated " +
        "tools (whoami, get_usage, webhooks) need NOVA_API_KEY set in the environment.",
    },
  );

  registerTools(server, client);
  return server;
}
