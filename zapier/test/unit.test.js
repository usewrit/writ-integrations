import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { signPayload, verifyWritSignature } = require('../lib/signature');
const { describeWritError } = require('../lib/errors');
const n = require('../lib/normalize');
const delivery = require('./signed-delivery.json');

const now = Number(delivery.timestamp) + 30;
const zapierHeaders = (signature, timestamp) => ({ 'Http-X-Writ-Signature-V1': signature, 'Http-X-Writ-Timestamp': timestamp });

describe('signature', () => {
  it('verifies a delivery Writ signed, with Zapier-style header names', () => {
    expect(signPayload(delivery.secret, delivery.timestamp, delivery.raw_body)).toBe(delivery.signature_v1);
    expect(verifyWritSignature(delivery.secret, zapierHeaders(delivery.signature_v1, delivery.timestamp), delivery.raw_body, now)).toEqual({ ok: true });
  });
  it('refuses a wrong secret, a re-serialised body, a replayed or old timestamp, and missing headers', () => {
    const h = zapierHeaders(delivery.signature_v1, delivery.timestamp);
    expect(verifyWritSignature('nope', h, delivery.raw_body, now).reason).toBe('mismatch');
    expect(verifyWritSignature(delivery.secret, h, JSON.stringify(JSON.parse(delivery.raw_body)), now).reason).toBe('mismatch');
    const later = String(Number(delivery.timestamp) + 3600);
    expect(verifyWritSignature(delivery.secret, zapierHeaders(delivery.signature_v1, later), delivery.raw_body, Number(later)).reason).toBe('mismatch');
    expect(verifyWritSignature(delivery.secret, h, delivery.raw_body, Number(delivery.timestamp) + 3600).reason).toBe('expired');
    expect(verifyWritSignature(delivery.secret, {}, delivery.raw_body, now).reason).toBe('missing');
  });
});

describe('errors', () => {
  it('splits 402 into a plan ceiling and missing credits', () => {
    expect(describeWritError(402, { detail: { message: 'Limit', limit: 3 } }).message).toContain('limit of 3');
    expect(describeWritError(402, { detail: 'Insufficient credits' }).message).toContain('Not enough Writ credits');
  });
  it('maps 401 to reconnect and 429 to throttle', () => {
    expect(describeWritError(401, {}).kind).toBe('auth');
    expect(describeWritError(429, {}, 30)).toMatchObject({ kind: 'throttle', retryAfter: 30 });
    expect(describeWritError(403, { detail: 'needs crawl:execute' }).message).toContain('crawl:execute');
  });
});

describe('normalize', () => {
  it('gives the change trigger one shape from a delivery and from the feed', () => {
    const hook = n.changeFromHook({
      event: 'change_detected', event_id: 'evt_1',
      target: { id: 4, url: 'https://e.com', name: 'E' },
      change: { id: 9, detected_at: '2026-11-19T00:00:00Z', content_before: 'a', content_after: 'b', content_truncated: true, full_content_after: 'bb', full_content_before: 'aa' },
    });
    expect(hook).toMatchObject({ id: 9, monitor_id: 4, content_before: 'aa', content_after: 'bb', content_truncated: false });
    const feed = n.changeFromFeed({ id: 9, target_id: 4, target_url: 'https://e.com', last_detected_at: '2026-11-19T00:00:00Z' });
    expect(Object.keys(feed).sort()).toEqual(Object.keys(hook).sort());
  });
  it('gives the run trigger one shape from a delivery and from a task', () => {
    const hook = n.runFromHook({ event: 'workflow_completed', event_id: 'evt_2', data: { workflow: { id: 3, name: 'W' }, run: { id: 7, status: 'success', success: true }, extracted_data: [{ a: 1 }] } });
    const task = n.runFromTask({ id: 7, workflow_id: 3, status: 'success', success: true, result_data: { extracted_data: [{ a: 1 }] } });
    expect(hook).toMatchObject({ id: 7, workflow_id: 3, success: true, extracted_data_json: '[{"a":1}]' });
    expect(Object.keys(task).sort()).toEqual(Object.keys(hook).sort());
  });
});
