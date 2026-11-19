# The contract

Both integrations call the Writ REST API directly and behave the same way.

## Authentication

- **API key** (n8n): `Authorization: Bearer wt_...`, created in Writ under Developers, API keys,
  with the scopes the workflow needs.
- **OAuth 2.0** (n8n and Zapier): authorization code with PKCE and refresh tokens, against
  `/api/oauth/authorize` and `/api/oauth/token`. Scopes requested:
  `account:read workflows:read workflows:execute runs:read datasets:read scrape:execute
  crawl:read crawl:execute monitors:read monitors:write monitors:execute triggers:read
  triggers:write triggers:delete`.

## Operations

| Operation | Request |
|---|---|
| Scrape a page | `POST /api/crawl/scrape` `{url, format, render_mode}` |
| Map a site | `POST /api/crawl/map` `{url, search, limit}` |
| Start a crawl | `POST /api/crawl` `{url, page_budget, intent, include_paths, exclude_paths}` |
| Crawl status | `GET /api/crawl/{id}` |
| Crawl pages, workflow data | `GET /api/v1/workflows/{data_workflow_id}/data?q=&limit=` |
| List workflows | `GET /api/automation/workflows` (crawl workflows left out) |
| Run a workflow | `POST /api/automation/workflows/{id}/run` `{form_data, function_name}` |
| Read a run | `GET /api/automation/tasks/{id}` |
| Monitors | `GET` / `POST /api/targets`, `POST /api/targets/{id}/run`, `GET /api/targets/{id}/changes` |
| Change feed | `GET /api/targets/changes/recent?since=&since_id=` |
| Webhook events | `GET /api/webhooks/event-types` |
| Subscriptions | `POST /api/webhooks/recipients`, `GET` / `DELETE /api/webhooks/recipients/{id}` |
| Connection test | `GET /api/auth/me` |

Waiting for a run or a crawl is optional and bounded: the client polls with backoff up to a
limit, then returns the run as still going instead of failing.

## Writes and retries

Every POST, PUT, PATCH and DELETE carries an `Idempotency-Key`, made once per call and kept
across its retries. Writ answers a repeated key with the first answer instead of running the
call again. The n8n node retries 408, 425, 429 and 5xx answers and dropped connections with
exponential backoff and full jitter, honouring `Retry-After` up to 30 seconds.

## Errors

| Status | Meaning | What the user sees |
|---|---|---|
| 401 | The credential was revoked or expired | Reconnect (Zapier refreshes the token first) |
| 402 with a numeric `limit` | A plan ceiling | The limit, and that a higher plan raises it |
| 402 otherwise | Not enough credits | Add credits |
| 403 | The credential lacks a scope | Writ's message, which names the scope |
| 404 | Not in this account | Writ's message |
| 429 | The account's API rate limit | Throttled, with the time to wait |
| 5xx | Writ had a problem | Retried, then reported |

## Events

`GET /api/webhooks/event-types` is the catalogue, each with a label, a description and a
sample payload: `change_detected`, `workflow_completed`, `crawl_completed`, `crawl_failed`,
`monitor_down`, `monitor_stale`, `monitor_recovered`, `notification`.

A subscription names the events it wants. It is created with `integration` (`n8n`, `zapier`)
and `external_ref` (the n8n workflow id, the Zap id) so the person can see in Writ what made
it, and Writ removes it once the credential that made it is revoked.

Every event payload has `event`, `event_id` and `timestamp`. `change_detected` also carries
`target` and `change` (`id`, `detected_at`, the content before and after, and
`content_truncated` when only the first 1,000 characters were sent); the others carry `data`.

## Signatures

`X-Writ-Signature-V1` is `sha256=` + hex HMAC-SHA256 over `X-Writ-Timestamp + "." + raw body`,
keyed with the subscription's secret. Clients verify against the raw bytes (never a
re-serialised object), compare in constant time, and refuse a timestamp more than ten minutes
from now. `X-Writ-Signature` (body only) is the older header and is not used here.
