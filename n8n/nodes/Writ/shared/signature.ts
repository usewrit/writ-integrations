import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Verifying a Writ webhook delivery.
 *
 * Writ signs each delivery with the subscription's secret:
 *
 *   X-Writ-Timestamp:    unix seconds when the delivery was made
 *   X-Writ-Signature-V1: "sha256=" + hex(HMAC-SHA256(secret, timestamp + "." + raw_body))
 *
 * The MAC covers the timestamp, so a captured delivery cannot be replayed later
 * under a fresh one, and it covers the RAW body bytes: verifying a re-serialised
 * JSON object fails on the first difference in spacing or key order.
 */

/** How old a delivery may be. Retries reuse the first attempt's timestamp. */
export const SIGNATURE_TOLERANCE_SECONDS = 600;

export type SignatureVerdict =
	| { ok: true }
	| { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };

export function newWebhookSecret(): string {
	return randomBytes(32).toString('hex');
}

export function signPayload(secret: string, timestamp: string, rawBody: Buffer | string): string {
	const mac = createHmac('sha256', secret);
	mac.update(`${timestamp}.`);
	mac.update(rawBody);
	return `sha256=${mac.digest('hex')}`;
}

function header(headers: Record<string, unknown>, name: string): string | undefined {
	const value = headers[name] ?? headers[name.toLowerCase()];
	if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
	return typeof value === 'string' ? value : undefined;
}

export function verifyWritSignature(
	secret: string,
	headers: Record<string, unknown>,
	rawBody: Buffer | string | undefined,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureVerdict {
	const signature = header(headers, 'x-writ-signature-v1');
	const timestamp = header(headers, 'x-writ-timestamp');
	if (!secret || !signature || !timestamp || rawBody === undefined) return { ok: false, reason: 'missing' };
	if (!/^\d{1,12}$/.test(timestamp) || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
		return { ok: false, reason: 'malformed' };
	}
	if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
		return { ok: false, reason: 'expired' };
	}
	const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return { ok: false, reason: 'mismatch' };
	}
	return { ok: true };
}
