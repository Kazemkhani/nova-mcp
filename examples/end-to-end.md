# End-to-end example

Prompt your MCP client (Claude Desktop, Claude Code, etc.) with something like:

> "Create a NOVA agent for `https://example-brokerage.ae`, then call
> `+971501234567` (his name is Ahmed, he enquired about a 2BR in JVC), wait
> ~5 minutes, then fetch the transcript and tell me whether he booked a
> viewing."

Under the hood, the agent will:

1. **`nova:create_agent`** — pass `url`, `goal: book_meeting`,
   `voice: sara_en`, `language: en`. Capture the returned `agent_id`.
2. **`nova:start_call`** — pass that `agent_id`, the `phone_number`,
   `lead_name: "Ahmed"`, and a `lead_context` string. Capture the `call_id`.
3. **`nova:get_transcript`** — pass the `call_id` and `format: "plain"`. The
   response contains the call outcome (`meeting_booked` | `qualified` |
   `not_interested` | etc.) plus the full transcript.

The whole flow is three tool calls. No HTTP plumbing, no SDK in your prompt —
the agent reads the schema NOVA-MCP advertises and decides what to do.
