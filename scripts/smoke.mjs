#!/usr/bin/env node
/**
 * Smoke test: boot the built server over real stdio, run the MCP handshake
 * (initialize → initialized → tools/list) and assert the advertised tool
 * count. No network calls are made — this only proves the binary boots and
 * speaks the protocol.
 *
 * Usage: npm run build && npm run smoke
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const EXPECTED_TOOL_COUNT = 12;
const TIMEOUT_MS = 15_000;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist", "index.js");

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: {
    ...process.env,
    // Point at an unreachable host on purpose: the handshake must work
    // without any API connectivity or credentials.
    NOVA_API_URL: "http://127.0.0.1:9",
    NOVA_API_KEY: "",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuf = "";
let stderrBuf = "";
const pending = new Map(); // id -> {resolve, reject}

child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk.toString("utf8");
  let nl;
  while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(
        `Server wrote a non-JSON line to stdout (protocol violation): ${line.slice(0, 200)}`,
      );
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error)
        reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    }
  }
});

child.stderr.on("data", (chunk) => {
  stderrBuf += chunk.toString("utf8");
});

child.on("exit", (code) => {
  if (!done)
    fail(`Server exited early with code ${code}. stderr:\n${stderrBuf}`);
});

let nextId = 1;
let done = false;

function send(method, params, isNotification = false) {
  const msg = {
    jsonrpc: "2.0",
    method,
    ...(params !== undefined ? { params } : {}),
  };
  if (!isNotification) msg.id = nextId++;
  child.stdin.write(JSON.stringify(msg) + "\n");
  if (isNotification) return Promise.resolve();
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
  });
}

function fail(reason) {
  done = true;
  console.error(`SMOKE FAIL: ${reason}`);
  child.kill();
  process.exit(1);
}

const timer = setTimeout(
  () => fail(`Timed out after ${TIMEOUT_MS}ms. stderr:\n${stderrBuf}`),
  TIMEOUT_MS,
);

try {
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.0.0" },
  });
  if (!init?.serverInfo?.name || init.serverInfo.name !== "nova-mcp") {
    fail(`Unexpected serverInfo: ${JSON.stringify(init?.serverInfo)}`);
  }
  await send("notifications/initialized", undefined, true);

  const toolsResult = await send("tools/list", {});
  const tools = toolsResult?.tools ?? [];
  if (tools.length !== EXPECTED_TOOL_COUNT) {
    fail(
      `Expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length}: ${tools
        .map((t) => t.name)
        .join(", ")}`,
    );
  }
  const missingDescriptions = tools.filter((t) => !t.description);
  if (missingDescriptions.length > 0) {
    fail(
      `Tools missing descriptions: ${missingDescriptions.map((t) => t.name).join(", ")}`,
    );
  }

  done = true;
  clearTimeout(timer);
  console.log(
    `SMOKE OK: server v${init.serverInfo.version} booted over stdio, ` +
      `${tools.length} tools advertised: ${tools.map((t) => t.name).join(", ")}`,
  );
  child.kill();
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
