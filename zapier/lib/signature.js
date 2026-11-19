'use strict';

const crypto = require('crypto');

/**
 * Writ signs each delivery with the subscription's secret:
 *   X-Writ-Timestamp:    unix seconds
 *   X-Writ-Signature-V1: "sha256=" + hex(HMAC-SHA256(secret, timestamp + "." + raw_body))
 * The MAC binds the timestamp (no replay under a fresh one) and the RAW body.
 */
const SIGNATURE_TOLERANCE_SECONDS = 600;

const newWebhookSecret = () => crypto.randomBytes(32).toString('hex');

function signPayload(secret, timestamp, rawBody) {
  const mac = crypto.createHmac('sha256', secret);
  mac.update(`${timestamp}.`);
  mac.update(rawBody);
  return `sha256=${mac.digest('hex')}`;
}

/** Zapier hands hook headers over as "Http-X-Writ-Timestamp"; accept both spellings. */
function header(headers, name) {
  if (!headers) return undefined;
  const wanted = [name.toLowerCase(), `http-${name.toLowerCase()}`];
  for (const [key, value] of Object.entries(headers)) {
    if (wanted.includes(key.toLowerCase())) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function verifyWritSignature(secret, headers, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const signature = header(headers, 'X-Writ-Signature-V1');
  const timestamp = header(headers, 'X-Writ-Timestamp');
  if (!secret || typeof signature !== 'string' || typeof timestamp !== 'string' || rawBody === undefined || rawBody === null) {
    return { ok: false, reason: 'missing' };
  }
  if (!/^\d{1,12}$/.test(timestamp) || !/^sha256=[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'expired' };
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

module.exports = { SIGNATURE_TOLERANCE_SECONDS, newWebhookSecret, signPayload, verifyWritSignature };
