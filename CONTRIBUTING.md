# Contributing

Two integrations, one contract ([`DESIGN.md`](./DESIGN.md)). A change to what an operation
does, what an error says or how a webhook is verified belongs in both, in one pull request.

## Setup

```bash
# n8n: Node 22+
cd n8n && npm ci && npm run build && npm run lint && npm test

# Zapier: Node 22+
cd zapier && npm ci && npm test && npx zapier-platform validate
```

`npm run lint` in `n8n/` is n8n's own community-node linter; the package has to pass it with no
errors and no warnings to stay eligible for n8n Cloud.

## Testing against a real Writ server

Both suites run without a network. The Zapier suite also has a live part, skipped unless
`WRIT_E2E=1` (see the header of `zapier/test/live.test.js` for the variables it needs). Use an
account made for testing, never production data.

## Rules

- **No runtime dependencies in `n8n/`.** n8n Cloud refuses community nodes that carry them.
- **English only, no emojis** in node and app copy.
- Credits, not currency, when the copy talks about usage.
- Every trigger, action and search keeps a sample and output field definitions (Zapier) and a
  test.

## Pull requests

Describe what changes and why, add a test that fails before the change, and update
`CHANGELOG.md` under `## [Unreleased]` naming the integration.
