# Security

These integrations talk to **Writ Cloud** (`https://api.usewrit.app`) with a credential you
create in Writ: an API key (n8n), or an OAuth connection (n8n or Zapier) whose scopes the Writ
consent screen lists before anything is granted. Nothing else leaves your n8n instance or
your Zap.

## Webhook triggers

Writ Trigger (n8n) and every Zapier trigger subscribe a URL in your Writ account with a fresh
random secret. Each delivery carries:

- `X-Writ-Timestamp`: unix seconds
- `X-Writ-Signature-V1`: `sha256=` + hex HMAC-SHA256 of `timestamp + "." + raw body`, keyed
  with that secret

A delivery whose signature does not match the raw body, or whose timestamp is more than ten
minutes away, is refused (HTTP 401 in n8n, an error in the Zap history) and starts nothing.
Deactivating the n8n workflow or turning the Zap off removes the subscription. Writ also
removes it by itself once the API key that made it is revoked, or once you disconnect the
OAuth app.

## Reporting a vulnerability

Report privately through **GitHub Security Advisories**: use the **"Report a vulnerability"**
button under the [Security tab of this repository](https://github.com/usewrit/writ-integrations/security/advisories/new).
Do **not** open a public issue for an undisclosed vulnerability.

- **Acknowledgement** within 3 business days.
- **Initial assessment** within 7 business days.
- Reporters are credited in the published advisory unless they prefer otherwise.
