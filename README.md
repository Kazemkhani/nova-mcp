# `@novalabs/nova-mcp`

Official Model Context Protocol (MCP) server for [NOVA Labs](https://novalabs.ae).

Gives an AI agent — Claude, GPT, Gemini, or any MCP-compatible client — the
ability to spin up a voice sales agent, place an outbound call, and read back
the transcript, all from a single tool surface.

> **Status:** v0.1.0 scaffold · API stable · published to npm soon ·
> server is functional but expects production NOVA API keys (request at
> [novalabs.ae](https://novalabs.ae)).

---

## What you get

Three tools exposed over stdio MCP:

| Tool             | What it does                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| `create_agent`   | Spins up a voice agent from a website URL. Returns `agent_id`.                |
| `start_call`     | Places an outbound call to a phone number with that agent. Returns `call_id`. |
| `get_transcript` | Fetches the transcript + outcome for a completed call.                        |

That's it. Three calls, end-to-end automation: an LLM can read a CRM, decide who
to call, and have NOVA call them — without the human ever wiring the glue.

---

## Quick start

### 1 · Install

```bash
npm install -g @novalabs/nova-mcp
```

Or run directly from source:

```bash
git clone https://github.com/Kazemkhani/nova-mcp.git
cd nova-mcp
npm install
npm run build
```

### 2 · Get an API key

Sign in at [novalabs.ae/dashboard](https://novalabs.ae/dashboard) and copy
your API key. Store it where your MCP client can read it as
`NOVA_API_KEY`.

### 3 · Configure your MCP client

#### Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "nova": {
      "command": "nova-mcp",
      "env": {
        "NOVA_API_KEY": "sk_live_…"
      }
    }
  }
}
```

#### Claude Code / `~/.claude/settings.json`

```json
{
  "mcpServers": {
    "nova": {
      "command": "npx",
      "args": ["-y", "@novalabs/nova-mcp"],
      "env": {
        "NOVA_API_KEY": "sk_live_…"
      }
    }
  }
}
```

Restart the client and you'll see three new tools available: `nova:create_agent`,
`nova:start_call`, `nova:get_transcript`.

---

## Tool reference

### `create_agent`

Scrape a URL, build product context, and return a voice agent ready to call.

```ts
{
  name: "Bayut SDR",                        // display name
  url: "https://example-brokerage.ae",       // scraped for product context
  goal: "book_meeting",                      // one of: book_meeting | qualify_lead | close_sale | collect_info
  voice: "sara_en",                          // sara_en | layla_ar | khalid_en | noor_en
  language: "en"                             // en | ar | hi | ur
}
```

Returns:

```ts
{
  agent_id: "ag_01HZK...",
  name: "Bayut SDR",
  status: "ready",
  context_summary: "Dubai brokerage offering 2–4BR rentals in JVC/JLT...",
  dashboard_url: "https://novalabs.ae/dashboard/agents/ag_01HZK..."
}
```

### `start_call`

Place an outbound call from a NOVA agent.

```ts
{
  agent_id: "ag_01HZK...",
  phone_number: "+971501234567",            // E.164 with leading +
  lead_name: "Ahmed",
  lead_context: "Enquired about 2BR JVC last Tuesday via Property Finder"
}
```

> NOVA opens every call with an AI-identification preamble and a
> recording-consent line. This is non-negotiable — UAE regulator-aware
> by default.

### `get_transcript`

Poll a call by ID. Use `format: "plain"` for a human-readable string or
`format: "json"` for turn-by-turn structured data with timestamps, intent
labels, and emotion scores.

```ts
{
  call_id: "call_01HZK...",
  format: "plain"
}
```

---

## End-to-end example (Claude Desktop)

Once configured, you can prompt your AI agent like this:

> "Look at the leads in `~/Desktop/leads.csv`, pick the three with the highest
> intent score, create a NOVA agent for our website at novalabs.ae targeting
> `book_meeting`, then call all three and report back with what each one said."

The agent will:

1. Read the CSV (filesystem MCP).
2. Call `create_agent` once.
3. Call `start_call` three times.
4. Wait a few minutes.
5. Call `get_transcript` for each `call_id` and summarise outcomes.

No bespoke integration. No Python glue. Just MCP tool calls.

---

## Configuration

| Env var           | Default                   | Description                                 |
| ----------------- | ------------------------- | ------------------------------------------- |
| `NOVA_API_KEY`    | _(required)_              | API key from `novalabs.ae/dashboard`.       |
| `NOVA_API_BASE`   | `https://api.novalabs.ae` | Override for staging / on-prem deployments. |
| `NOVA_TIMEOUT_MS` | `30000`                   | Request timeout (ms).                       |

---

## How this fits into NOVA's stack

```
                     ┌────────────────────────────────────┐
   Your LLM ─────────►│  nova-mcp  (this package)         │
   (Claude, GPT, etc.)│  stdio MCP server                 │
                     └──────────────┬─────────────────────┘
                                    │  HTTPS · Bearer auth
                                    ▼
                     ┌────────────────────────────────────┐
                     │  api.novalabs.ae                   │
                     │  FastAPI · Fly.io Bahrain          │
                     └──────────────┬─────────────────────┘
                                    │
                                    ▼
                     ┌────────────────────────────────────┐
                     │  NOVA voice agents                 │
                     │  LiveKit + multilingual TTS/STT    │
                     │  4-phase state machine             │
                     └────────────────────────────────────┘
```

---

## Development

```bash
npm install
npm run watch          # rebuild on change
NOVA_API_KEY=sk_test_… npm run start
```

### Debugging the MCP wire protocol

```bash
NOVA_API_KEY=sk_test_… npx @modelcontextprotocol/inspector node dist/index.js
```

Inspector gives you a UI to see the JSON-RPC `tools/list` and `tools/call`
messages in real time.

---

## Roadmap

- [ ] **v0.2** — `list_agents`, `update_agent`, `delete_agent`
- [ ] **v0.3** — Webhook tool: subscribe to call events (`call.completed`, `meeting.booked`)
- [ ] **v0.4** — `list_calls` with filters (date range, outcome, vertical)
- [ ] **v0.5** — Knowledge-base tools: attach PDFs / Notion docs as agent context
- [ ] **v1.0** — npm publish + listed in the official MCP server directory

---

## License

MIT © [NOVA Labs](https://novalabs.ae). Dubai, UAE.

Built by [Amir Hossein Kazemkhani](https://amirkazemkhani.com). Featured on
_Falcons of Majlis_ (India Today × Aaj Tak).
