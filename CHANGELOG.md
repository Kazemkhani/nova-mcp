# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org).

## [Unreleased]

### Added

- Contribution, security, and conduct policies plus structured issue and pull
  request templates.

### Changed

- Updated the Model Context Protocol SDK and transitive dependency lockfile;
  `npm audit` now reports zero known vulnerabilities.
- CI and package support now target the maintained Node.js 22 and 24 LTS lines.

## [1.0.0] - 2026-06-12

First production-grade release. The server now targets the **real**
api.novalabs.ae surface (the 0.1.0 scaffold spoke to endpoints that did not
exist) and ships with tests, CI and a stdio smoke test.

### Added

- **12 tools** mapped 1:1 to live API endpoints:
  `health_check`, `whoami`, `place_calls`, `get_call`, `get_call_brief`,
  `get_call_quality`, `get_usage`, `list_webhooks`, `create_webhook`,
  `delete_webhook`, `test_webhook`, `get_demo_token`.
- Strict zod input validation with cross-field checks (goal-specific required
  links, duplicate-phone detection, E.164/UUID formats, HTTPS-only webhooks)
  and a mandatory `consent: true` literal on `place_calls`.
- Actionable error mapping for every failure mode: 401 → how to get a token,
  402 → check `get_usage`, 404 → 10-minute TTL hint, 422 → flattened FastAPI
  field errors, 429 → rate-limit guidance, network/timeout → config hints.
- Graceful degradation without `NOVA_API_KEY`: public tools work, account
  tools return setup instructions instead of failing opaquely.
- Bounded retries (2x, backoff) for idempotent GETs on 502/503/504 and network
  errors; POSTs are never retried (no double-dial risk).
- Demo-mode support: `place_calls` documents browser-demo behaviour and
  `get_demo_token` mints LiveKit join tokens for room `call-<context_id>`.
- Test suite: 47 vitest tests with mocked network, including full
  client↔server tests over an in-memory MCP transport.
- GitHub Actions CI (lint + typecheck + test + build + smoke, Node 20/22).
- Stdio smoke script asserting the MCP handshake and advertised tool count.
- Runnable `examples/quickstart.mjs`, paste-ready Claude Desktop / Cursor
  configs, rewritten end-to-end walkthrough.
- `--help` / `--version` CLI flags; MCP `instructions` hint for clients;
  tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

### Changed

- Package renamed `@novalabs/nova-mcp` → **`nova-mcp`** (name is free on npm;
  enables `npx nova-mcp`).
- Replaced the hand-rolled zod→JSON-Schema converter with the SDK's
  `McpServer.registerTool` API (`@modelcontextprotocol/sdk` ^1.29).
- `NOVA_API_URL` is the canonical base-URL variable (`NOVA_API_BASE` still
  accepted as a legacy alias).
- README rewritten: quickstart for Claude Code / Claude Desktop / Cursor,
  full tool reference, auth setup, troubleshooting matrix, badges.

### Removed

- Fictional tools `create_agent`, `start_call`, `get_transcript` that targeted
  non-existent endpoints (`/api/agents`, `/api/calls/{id}/transcript`).
  Transcript retrieval will return as `get_transcript` once the API exposes it
  (today transcripts arrive via owner email / `call.transcribed` webhooks).

## [0.1.0] - 2026-06-11

- Initial scaffold: stdio server with three speculative tools and a thin
  fetch client.
