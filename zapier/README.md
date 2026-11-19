# Writ for Zapier

The [Writ](https://usewrit.app) app for Zapier: scrape and map pages, crawl sites, run the APIs
you built in Writ, watch pages for changes, and start Zaps from Writ events.

## Triggers

| Trigger | Starts a Zap when |
|---|---|
| New Change Detected | a Writ monitor detects that a page changed |
| Workflow Run Finished | a run of a workflow finishes (filter by workflow and outcome) |
| Crawl Finished | a crawl finishes, or fails |
| Monitor Status Changed | a monitor goes down, stops reporting, or recovers |

Triggers are instant: Writ pushes each event to Zapier, signed with a secret made for the
subscription, and the app refuses anything that is not signed with it. Turning the Zap off
removes the subscription in Writ. A change detected again later starts the Zap again.

## Actions

Scrape Page, Map Site, Start Crawl, Run Workflow (waits up to 20 seconds for the result),
Create Monitor, Check Monitor Now.

## Searches

Find Workflow, Find Monitor, Find Records (rows a workflow extracted).

## Connecting

Zapier connects to your Writ account with OAuth. The Writ consent screen lists what Zapier will
be able to do. Disconnecting Zapier in Writ also removes the subscriptions its Zaps made.

Each action uses your Writ account's credits as the same call does from the Writ app or the API.

## Development

```bash
npm ci
npm test                      # offline: a stand-in Writ API on localhost
npx zapier-platform validate
```

`test/live.test.js` runs the app against a real Writ server when `WRIT_E2E=1` (the variables
it needs are listed at the top of the file).

## License

[MIT](./LICENSE)
