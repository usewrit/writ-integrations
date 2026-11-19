'use strict';

/**
 * How a Writ API error reads in a Zap. Same table as the n8n node:
 *   401  reconnect the Writ account
 *   402  a plan ceiling (numeric `limit` in the body) or not enough credits
 *   403  the connection lacks a scope (the body names it)
 *   429  the account's API rate limit, with Retry-After
 */

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function errorText(body) {
  if (typeof body === 'string') return body.slice(0, 500);
  const record = asRecord(body);
  if (!record) return '';
  const detail = record.detail;
  if (typeof detail === 'string') return detail.slice(0, 500);
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => {
        const item = asRecord(entry);
        if (!item) return String(entry);
        const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
        return loc ? `${loc}: ${item.msg ?? ''}` : String(item.msg ?? '');
      })
      .join('; ')
      .slice(0, 500);
  }
  for (const source of [asRecord(detail), record]) {
    if (!source) continue;
    for (const key of ['message', 'error_description', 'error', 'detail']) {
      if (typeof source[key] === 'string' && source[key]) return source[key].slice(0, 500);
    }
  }
  return '';
}

function planLimit(body) {
  const record = asRecord(body);
  for (const source of [asRecord(record && record.detail), record]) {
    const limit = source && source.limit;
    if (typeof limit === 'number' && Number.isFinite(limit)) return limit;
  }
  return undefined;
}

/** { kind, message } where kind is 'auth' | 'throttle' | 'halt' | 'error'. */
function describeWritError(status, body, retryAfterSeconds) {
  const text = errorText(body);
  const lead = text ? `${text}. ` : '';
  if (status === 401) {
    return { kind: 'auth', message: `${lead}Reconnect your Writ account: the connection was revoked or has expired.` };
  }
  if (status === 402) {
    const limit = planLimit(body);
    if (limit !== undefined) {
      return { kind: 'halt', message: `${lead}This is over your Writ plan's limit of ${limit}. Upgrade the plan in Writ to go further.` };
    }
    return { kind: 'halt', message: `${lead}Not enough Writ credits for this call. Add credits in Writ, then replay the Zap run.` };
  }
  if (status === 403) {
    return { kind: 'halt', message: `${lead}Reconnect your Writ account to grant the permission named above.` };
  }
  if (status === 404) return { kind: 'halt', message: text || 'Not found in your Writ account.' };
  if (status === 429) {
    return { kind: 'throttle', message: `${lead}Writ's rate limit for your account was reached.`, retryAfter: retryAfterSeconds ?? 60 };
  }
  if (status >= 500) return { kind: 'error', message: `${lead}Writ had a problem answering. Try again in a moment.` };
  return { kind: 'error', message: text || `Writ answered ${status}.` };
}

module.exports = { describeWritError, errorText };
