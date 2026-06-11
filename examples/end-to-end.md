# End-to-end example

Prompt your MCP client (Claude Desktop, Claude Code, Cursor, …) with something like:

> "Place a NOVA call to +971501234567 (his name is Ahmed, he enquired about a
> 2BR in JVC). We sell AI voice agents for real-estate brokers — qualify his
> interest. My email is owner@example.com, the lead has consented. Then give
> me a browser join link token so I can listen in, and once it's done check
> the quality score."

Under the hood, the agent will:

1. **`place_calls`** — one batch with one lead:

   ```jsonc
   {
     "owner_email": "owner@example.com",
     "product": "AI voice agents for real-estate brokers",
     "leads": [{ "phone": "+971501234567", "name": "Ahmed" }],
     "goal": "qualify_interest",
     "language": "en",
     "context": "Enquired about a 2BR in JVC last Tuesday",
     "consent": true,
   }
   ```

   The response contains a `call_id` and `context_id` per lead.

2. **`get_demo_token`** — pass the `context_id`. NOVA is in demo mode (no real
   PSTN dial): the AI agent waits in LiveKit room `call-<context_id>`, and the
   returned `server_url` + `participant_token` let a human join from the
   browser and hold the actual conversation.

3. **`get_call`** — poll the `call_id` while the call runs
   (records expire after 10 minutes).

4. **`get_call_quality`** — after completion, fetch the LLM-as-judge
   5-dimension quality score. `score: null` means "not scored yet, retry".

Full results (transcript + outcome) are emailed to `owner_email` when the
call ends. To get push notifications instead, register a webhook:

> "Register a webhook at https://example.com/nova-events for call.started and
> call.ended, and send a test event to verify it."

(`create_webhook` → save the show-once signing secret → `test_webhook`.)

## Programmatic usage

See [`quickstart.mjs`](./quickstart.mjs) for driving the server from code with
the MCP TypeScript SDK:

```bash
npm install && npm run build
node examples/quickstart.mjs
```
