## What this changes

## Why

## Which integrations

- [ ] n8n
- [ ] Zapier

<!-- A behaviour change (an operation, an error message, webhook verification) belongs in
     both, in this PR. -->

## Checklist

- [ ] Tests pass for every integration I touched, with a test that fails before the change
- [ ] `n8n`: `npm run lint` shows no errors and no warnings; still no runtime dependencies
- [ ] `zapier`: `npx zapier-platform validate` passes; samples and output fields kept up to date
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`
- [ ] `DESIGN.md` updated if the contract changed
