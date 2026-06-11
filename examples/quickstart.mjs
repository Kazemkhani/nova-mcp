#!/usr/bin/env node
/**
 * Runnable example: connect to the nova-mcp server programmatically,
 * list its tools, and call health_check against the live NOVA API.
 *
 * Run from the repo root:
 *   npm install && npm run build
 *   node examples/quickstart.mjs
 *
 * Optionally set NOVA_API_KEY to also exercise the authenticated whoami tool.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: {
    ...process.env,
    NOVA_API_URL: process.env.NOVA_API_URL ?? "https://api.novalabs.ae",
  },
});

const client = new Client({ name: "quickstart-example", version: "1.0.0" });
await client.connect(transport);

// 1. Discover tools
const { tools } = await client.listTools();
console.log(`Connected. ${tools.length} tools available:`);
for (const tool of tools) console.log(`  - ${tool.name}: ${tool.title ?? ""}`);

// 2. Call a public tool (no auth needed)
console.log("\nCalling health_check…");
const health = await client.callTool({ name: "health_check", arguments: {} });
console.log(health.content[0].text);

// 3. Authenticated tool — demonstrates graceful degradation without a key
console.log("\nCalling whoami…");
const me = await client.callTool({ name: "whoami", arguments: {} });
console.log(
  me.isError
    ? `(expected without NOVA_API_KEY) ${me.content[0].text}`
    : me.content[0].text,
);

await client.close();
