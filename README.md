# nova-mcp

**The official MCP server for [NOVA Labs](https://novalabs.ae) — give any AI agent a voice that picks up the phone.**

[![CI](https://github.com/Kazemkhani/nova-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Kazemkhani/nova-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nova-mcp)](https://www.npmjs.com/package/nova-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)

Claude (or any MCP client) reads your CRM, decides who to call, and NOVA's AI
voice agents make the calls — qualify leads, book meetings, collect info,
close sales — in English or Gulf Arabic. This server exposes the entire
[api.novalabs.ae](https://api.novalabs.ae) surface as **12 typed, validated
MCP tools** over stdio.

> **Demo mode (today):** NOVA currently runs in browser-demo mode — `place_calls`
> dispatches a real AI agent into a live voice room, but no phone (PSTN) dial is
> placed. Use `get_demo_token` to join the agent's room from a browser and have
> the conversation yourself. The API contract is identical to production dialing.

---

## 60-second quickstart

### 1 · Get a token (optional, unlocks account tools)

```bash
curl -X POST https://api.novalabs.ae/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'
# → copy "access_token" — that's your NOVA_API_KEY
```

No account? Sign up at [novalabs.ae](https://novalabs.ae). Public tools
(`health_check`, `place_calls`, `get_call`, …) work without a token.

### 2 · Add to your MCP client

**Claude Code** (one command):

```bash
claude mcp add nova --env NOVA_API_KEY=YOUR_TOKEN -- npx -y nova-mcp
```

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nova": {
      "command": "npx",
      "args": ["-y", "nova-mcp"],
      "env": { "NOVA_API_KEY": "YOUR_TOKEN" }
    }
  }
}
```

**Cursor** — `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "nova": {
      "command": "npx",
      "args": ["-y", "nova-mcp"],
      "env": { "NOVA_API_KEY": "YOUR_TOKEN" }
    }
  }
}
```

### 3 · Talk to it

> "Place a NOVA call to +971501234567 — his name is Ahmed, qualify his interest
> in our 2BR JVC listings. My email is owner@example.com, he's consented. Then
> get me a demo token so I can join the call."

---

## Tools

| Tool               | Endpoint                        | Auth     | What it does                                                                                                                    |
| ------------------ | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `health_check`     | `GET /health` (+`/health/deep`) | none     | API liveness; `deep=true` probes DB + LiveKit.                                                                                  |
| `whoami`           | `GET /auth/me`                  | required | Verify your token; account + trial status.                                                                                      |
| `place_calls`      | `POST /calls`                   | optional | Dispatch AI voice calls to 1–5 leads in one batch. Returns `call_id` + `context_id` per lead.                                   |
| `get_call`         | `GET /calls/{id}`               | optional | Live call status (pending / in_progress / completed / failed). 10-minute TTL.                                                   |
| `get_call_brief`   | `GET /contexts/{id}`            | optional | The AI-generated brief: system prompt, opening line, objection handlers, product facts.                                         |
| `get_call_quality` | `GET /api/calls/{id}/quality`   | optional | LLM-as-judge 5-dimension quality score (async; `null` = pending).                                                               |
| `get_usage`        | `GET /billing/usage`            | required | Plan, minutes used/remaining, trial expiry.                                                                                     |
| `list_webhooks`    | `GET /v1/webhooks`              | required | Registered webhooks (secrets never re-shown).                                                                                   |
| `create_webhook`   | `POST /v1/webhooks`             | required | Subscribe an HTTPS URL to `call.started` / `call.ended` / `call.transcribed` / `call.scored`. Signing secret returned **once**. |
| `delete_webhook`   | `DELETE /v1/webhooks/{id}`      | required | Deactivate a webhook (idempotent soft delete).                                                                                  |
| `test_webhook`     | `POST /v1/webhooks/{id}/test`   | required | Fire a fake `call.started` event at your receiver.                                                                              |
| `get_demo_token`   | `POST /token`                   | optional | LiveKit browser token to join a live call room (`call-<context_id>`).                                                           |

Every tool has strict zod-validated inputs (E.164 phones, UUIDs, enum goals,
HTTPS-only webhook URLs) and cross-field checks (`book_meeting` ⇒
`booking_link`, `close_sale` ⇒ `payment_link`, no duplicate phones) — invalid
calls fail instantly with a precise message, before any HTTP round-trip.

### `place_calls` in one look

```jsonc
{
  "owner_email": "owner@example.com", // results are emailed here
  "product": "AI voice agents for real-estate brokers",
  "leads": [
    { "phone": "+971501234567", "name": "Ahmed", "company": "Acme Realty" },
  ], // 1-5 leads, unique E.164 phones
  "goal": "qualify_interest", // book_meeting | qualify_interest | collect_info | close_sale
  "language": "en", // en | ar-AE (Gulf Arabic)
  "website_url": "https://example.com", // optional: scraped for context
  "consent": true, // mandatory — leads must have consented
}
```

---

## Configuration

| Env var           | Default                   | Description                                                                                       |
| ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `NOVA_API_KEY`    | _(unset)_                 | Bearer token from `POST /auth/login`. Optional — account tools explain how to get one if missing. |
| `NOVA_API_URL`    | `https://api.novalabs.ae` | API base URL (staging / self-hosted). `NOVA_API_BASE` accepted as legacy alias.                   |
| `NOVA_TIMEOUT_MS` | `30000`                   | Per-request timeout in milliseconds.                                                              |

No secrets are ever stored in code or on disk — configuration is environment-only.

---

## Troubleshooting

| Symptom                                | Fix                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`                     | Token expired or wrong. Re-run `POST /auth/login`, update `NOVA_API_KEY`, restart your MCP client.                                                      |
| `"NOVA_API_KEY is not set"`            | You called an account tool without a token — follow the login instructions in the error.                                                                |
| `402 Payment Required`                 | Plan/trial minutes exhausted — check `get_usage`, upgrade at [novalabs.ae](https://novalabs.ae).                                                        |
| `404` on `get_call` / `get_call_brief` | Call records are **ephemeral (10-minute TTL)** — they expire after the call. Full results are emailed to `owner_email`; use webhooks for push delivery. |
| `429 Rate limited`                     | Max ~5 call submissions/minute/IP. Wait 60s.                                                                                                            |
| `Could not reach the NOVA API`         | Check network + `NOVA_API_URL`; run the `health_check` tool.                                                                                            |
| Timeouts                               | Cold-start or slow network — raise `NOVA_TIMEOUT_MS`.                                                                                                   |
| Server won't appear in client          | Run `npx -y nova-mcp --version` in a terminal; check your client's MCP logs. The server logs to stderr only.                                            |

### Debugging the wire protocol

```bash
npx @modelcontextprotocol/inspector npx -y nova-mcp
```

---

## Examples

The [`examples/`](./examples) directory actually runs:

- [`quickstart.mjs`](./examples/quickstart.mjs) — drive the server from code (list tools, call `health_check` live): `node examples/quickstart.mjs`
- [`end-to-end.md`](./examples/end-to-end.md) — full prompt-driven call flow, demo-mode walkthrough, webhooks
- [`claude-desktop-config.json`](./examples/claude-desktop-config.json) / [`cursor-mcp.json`](./examples/cursor-mcp.json) — paste-ready client configs

---

## How it fits

```
 Your LLM (Claude, GPT, …)
        │  MCP over stdio
        ▼
 nova-mcp  ── 12 tools, zod-validated, actionable errors
        │  HTTPS · Bearer JWT
        ▼
 api.novalabs.ae  ── FastAPI · Fly.io
        │
        ▼
 NOVA voice agents ── LiveKit rooms · EN + Gulf-Arabic TTS/STT
                      (demo mode: browser joins the room; prod: SIP dial)
```

---

## Development

```bash
git clone https://github.com/Kazemkhani/nova-mcp.git && cd nova-mcp
npm install
npm run verify   # lint + typecheck + test (47 tests) + build + stdio smoke test
```

- **TypeScript strict** (`noUncheckedIndexedAccess`, `noImplicitOverride`, …)
- **Tests**: vitest, network fully mocked; tools tested through a real MCP client over an in-memory transport
- **CI**: GitHub Actions on every push/PR (maintained Node 22 + 24 LTS lines)
- **Smoke test**: boots the built binary over real stdio and asserts the handshake + tool count

### Releasing to npm

```bash
npm publish   # prepublishOnly runs the full verify pipeline first
```

Requires an npm account with publish rights to the `nova-mcp` package name
(`npm login`, or an `NPM_TOKEN` in CI).

## API surface not (yet) covered

Transcripts and call recordings are delivered by email / webhooks
(`call.transcribed`) today — the API does not expose a transcript GET endpoint
yet. When it ships, a `get_transcript` tool will land here in a minor release.

---

## License

MIT © [NOVA Labs](https://novalabs.ae) — Dubai, UAE.
Built by [Amir Hossein Kazemkhani](https://amirkazemkhani.com).
