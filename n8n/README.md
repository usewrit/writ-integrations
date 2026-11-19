# n8n-nodes-writ

The official [Writ](https://usewrit.app) nodes for [n8n](https://n8n.io). Writ turns any
website into an API: read a page as clean markdown, map or crawl a site, run the APIs you built
in Writ, watch pages for changes, and start a workflow when Writ reports something.

## Install

In n8n: **Settings**, **Community Nodes**, **Install**, then enter `n8n-nodes-writ`.

## Nodes

### Writ

| Resource | Operations |
|---|---|
| Page | Scrape (markdown, HTML or both), Map Site |
| Crawl | Start (optionally waits for it to finish), Get, Get Pages |
| Workflow | Run (with inputs, optionally waits for the result), Get Run, Get Many, Get Data |
| Monitor | Create, Check Now, Get Many, Get Changes |

The node can be used as a tool by n8n's AI Agent.

Waiting is bounded by **Max Wait**: a run or crawl still going after it is returned with
`finished: false`, so the workflow is never stuck.

### Writ Trigger

Starts the workflow when Writ sends one of the events you pick: a monitor detected a change, a
workflow run finished, a crawl finished or failed, a monitor went down, stopped reporting or
recovered, or an automation sent a notification. The list comes from Writ, so new events show
up without updating the node.

Activating the workflow subscribes its webhook URL in Writ with a random secret; deactivating
it removes the subscription. Every delivery is checked against that secret and refused if it
does not match. n8n must be reachable from the internet for Writ to deliver; if it is not, use
the Writ Changes Trigger.

### Writ Changes Trigger

Checks Writ for new detected changes on n8n's schedule. The first check only records where the
feed is, so activating it does not replay old changes. A change Writ detects again later
starts the workflow again.

## Credentials

Pick one in the node's **Authentication** field.

- **API Key**: create a key in Writ under **Developers**, **API keys**. Give it the scopes your
  workflows need, for example `scrape:execute` to scrape, `workflows:execute` and `runs:read` to
  run workflows, `triggers:write` and `triggers:delete` for Writ Trigger.
- **OAuth2**: in Writ, under **Integrations**, create an OAuth app whose redirect URL is the
  **OAuth Redirect URL** shown in the n8n credential, then paste its client ID and secret into
  n8n and connect. The Writ consent screen lists what n8n will be able to do.

Leave **API URL** as it is unless Writ support gives you another address.

## Usage and credits

Each operation uses your Writ account's credits as the same call does from the Writ app or the
API. Your plan's API rate limit applies to all of your credentials together; when it is
reached, the node waits and retries briefly, then reports how long to wait.

## Development

```bash
npm ci
npm run build
npm run lint   # n8n's community-node rules: must show no errors and no warnings
npm test
```

## License

[MIT](./LICENSE)
