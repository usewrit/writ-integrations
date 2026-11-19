import { describe, expect, it } from 'vitest';

import { signPayload, verifyWritSignature } from '../nodes/Writ/shared/signature';
import delivery from './fixtures/signed-delivery.json';

const headers = (signature: string, timestamp: string) => ({
	'x-writ-signature-v1': signature,
	'x-writ-timestamp': timestamp,
});
const now = Number(delivery.timestamp) + 30;

describe('verifyWritSignature', () => {
	it('accepts a delivery signed by Writ', () => {
		const raw = Buffer.from(delivery.raw_body);
		expect(signPayload(delivery.secret, delivery.timestamp, raw)).toBe(delivery.signature_v1);
		expect(
			verifyWritSignature(delivery.secret, headers(delivery.signature_v1, delivery.timestamp), raw, now),
		).toEqual({ ok: true });
	});

	it('refuses the wrong secret', () => {
		const verdict = verifyWritSignature(
			'another-secret',
			headers(delivery.signature_v1, delivery.timestamp),
			Buffer.from(delivery.raw_body),
			now,
		);
		expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
	});

	it('refuses a re-serialised body', () => {
		const reserialised = JSON.stringify(JSON.parse(delivery.raw_body));
		expect(reserialised).not.toBe(delivery.raw_body);
		const verdict = verifyWritSignature(
			delivery.secret,
			headers(delivery.signature_v1, delivery.timestamp),
			reserialised,
			now,
		);
		expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
	});

	it('refuses a replay under a new timestamp', () => {
		const later = String(Number(delivery.timestamp) + 3600);
		const verdict = verifyWritSignature(
			delivery.secret,
			headers(delivery.signature_v1, later),
			delivery.raw_body,
			Number(later),
		);
		expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
	});

	it('refuses an old delivery', () => {
		const verdict = verifyWritSignature(
			delivery.secret,
			headers(delivery.signature_v1, delivery.timestamp),
			delivery.raw_body,
			Number(delivery.timestamp) + 3600,
		);
		expect(verdict).toEqual({ ok: false, reason: 'expired' });
	});

	it('refuses missing or malformed headers and a missing body', () => {
		expect(verifyWritSignature(delivery.secret, {}, delivery.raw_body, now).ok).toBe(false);
		expect(verifyWritSignature('', headers(delivery.signature_v1, delivery.timestamp), delivery.raw_body, now)).toEqual(
			{ ok: false, reason: 'missing' },
		);
		expect(
			verifyWritSignature(delivery.secret, headers(delivery.signature_v1, delivery.timestamp), undefined, now),
		).toEqual({ ok: false, reason: 'missing' });
		expect(
			verifyWritSignature(delivery.secret, headers('sha1=abc', delivery.timestamp), delivery.raw_body, now),
		).toEqual({ ok: false, reason: 'malformed' });
		expect(
			verifyWritSignature(delivery.secret, headers(delivery.signature_v1, 'yesterday'), delivery.raw_body, now),
		).toEqual({ ok: false, reason: 'malformed' });
	});

	it('reads array-valued headers (Node joins repeated headers into arrays)', () => {
		const verdict = verifyWritSignature(
			delivery.secret,
			{ 'x-writ-signature-v1': [delivery.signature_v1], 'x-writ-timestamp': [delivery.timestamp] },
			delivery.raw_body,
			now,
		);
		expect(verdict).toEqual({ ok: true });
	});
});
