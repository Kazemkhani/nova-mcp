# Contributing to nova-mcp

Thanks for helping make NOVA's MCP integration more useful and reliable.

## Before you start

- Search the existing issues before opening a new one.
- Use a focused issue for behavior changes, new tools, or API-contract changes.
- Never include API keys, access tokens, phone numbers, call recordings, transcripts, or customer data in issues, fixtures, logs, or pull requests.

## Development setup

nova-mcp supports the maintained Node.js 22 and 24 LTS lines in CI.

```bash
git clone https://github.com/Kazemkhani/nova-mcp.git
cd nova-mcp
npm ci
npm run verify
```

`npm run verify` runs linting, TypeScript checks, the offline test suite, a production build, and an MCP stdio smoke test.

## Pull requests

1. Create a short branch from `main`.
2. Keep the change scoped and add or update tests for observable behavior.
3. Update the README, examples, and changelog when the public contract changes.
4. Run `npm run verify` before opening the pull request.
5. Explain the user problem, the approach, and how you verified it.

The default test suite must stay deterministic and must not call NOVA or another paid provider. Put live-provider checks behind an explicit opt-in command.

AI-assisted contributions are welcome, but contributors remain responsible for understanding, testing, and explaining every submitted change.

## Reporting security issues

Please follow [SECURITY.md](SECURITY.md) instead of opening a public issue for a suspected vulnerability.
