# Changelog

All notable changes to the Writ integrations. Each entry names the integration it affects.

## [Unreleased]

- Both: CI runs on Node 22 and 24 and the packages require Node 22 or later (the n8n and Zapier
  tooling no longer supports Node 20). The Zapier release workflow file now parses.

## n8n 0.1.0 and Zapier 0.1.0 (first release)

- **n8n**: `Writ` node (Page: Scrape, Map Site; Crawl: Start, Get, Get Pages; Workflow: Run,
  Get Run, Get Many, Get Data; Monitor: Create, Check Now, Get Many, Get Changes), usable as an
  AI Agent tool. `Writ Trigger` (webhook, every Writ event, signature-verified) and
  `Writ Changes Trigger` (polling). API key and OAuth2 credentials. No runtime dependencies.
- **Zapier**: OAuth 2.0 with PKCE and refresh. Triggers: New Change Detected, Workflow Run
  Finished, Crawl Finished, Monitor Status Changed (REST hooks, signature-verified, with real
  sample data). Actions: Scrape Page, Map Site, Start Crawl, Run Workflow, Create Monitor,
  Check Monitor Now. Searches: Find Workflow, Find Monitor, Find Records.
