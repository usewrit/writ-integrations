/**
 * How a Writ API error reads in n8n. Pure (no n8n imports) so it is unit-tested
 * on its own; transport.ts turns the result into a NodeApiError.
 *
 * The status codes mean different things to the person reading the error:
 *   401  the credential is wrong, revoked or expired: reconnect it.
 *   402  either a plan ceiling (the body carries a numeric `limit`) or not
 *        enough credits for this call. Different fixes, so different messages.
 *   403  the API key or OAuth grant lacks the scope this call needs.
 *   404  the id does not exist in this account.
 *   409  a conflict the body explains (for example the webhook limit).
 *   422  the request was refused as invalid; the body names the field.
 *   429  the account's API rate limit; Retry-After says when to try again.
 *   5xx  Writ had a problem; worth retrying later.
 */

export interface WritErrorInfo {
	httpCode: string;
	message: string;
	description: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** The human sentence a Writ error body carries, wherever it put it. */
export function errorText(body: unknown): string {
	if (typeof body === 'string') return body.slice(0, 500);
	const record = asRecord(body);
	if (!record) return '';
	const detail = record.detail;
	if (typeof detail === 'string') return detail.slice(0, 500);
	if (Array.isArray(detail)) {
		// FastAPI validation errors: [{loc: [...], msg: "..."}]
		return detail
			.map((entry) => {
				const item = asRecord(entry);
				if (!item) return String(entry);
				const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
				return loc ? `${loc}: ${String(item.msg ?? '')}` : String(item.msg ?? '');
			})
			.join('; ')
			.slice(0, 500);
	}
	const nested = asRecord(detail);
	for (const source of [nested, record]) {
		if (!source) continue;
		for (const key of ['message', 'error_description', 'error', 'detail']) {
			if (typeof source[key] === 'string' && source[key]) return (source[key] as string).slice(0, 500);
		}
	}
	return '';
}

/** A numeric `limit` anywhere at the top of the body marks a plan ceiling. */
function planLimit(body: unknown): number | undefined {
	const record = asRecord(body);
	const nested = asRecord(record?.detail);
	for (const source of [nested, record]) {
		const limit = source?.limit;
		if (typeof limit === 'number' && Number.isFinite(limit)) return limit;
	}
	return undefined;
}

export function describeWritError(
	status: number,
	body: unknown,
	retryAfterSeconds?: number,
): WritErrorInfo {
	const text = errorText(body);
	const httpCode = String(status);
	switch (status) {
		case 401:
			return {
				httpCode,
				message: 'Writ did not accept the credential',
				description:
					(text ? `${text}. ` : '') +
					'Check the API key, or reconnect the OAuth credential: it may have been revoked or expired.',
			};
		case 402: {
			const limit = planLimit(body);
			if (limit !== undefined) {
				return {
					httpCode,
					message: 'This call is over your Writ plan limit',
					description:
						(text ? `${text}. ` : '') + `The plan allows ${limit}. Upgrade the plan in Writ to go further.`,
				};
			}
			return {
				httpCode,
				message: 'Not enough Writ credits for this call',
				description: (text ? `${text}. ` : '') + 'Add credits in Writ, then run the node again.',
			};
		}
		case 403:
			return {
				httpCode,
				message: 'The credential is not allowed to do this',
				description:
					(text ? `${text}. ` : '') +
					'Give the API key (or the OAuth app) the scope named above in Writ, under Developers.',
			};
		case 404:
			return { httpCode, message: 'Not found in your Writ account', description: text || 'Check the id.' };
		case 429:
			return {
				httpCode,
				message: 'Writ rate limit reached',
				description:
					(text ? `${text}. ` : '') +
					(retryAfterSeconds !== undefined
						? `Try again in ${Math.ceil(retryAfterSeconds)} seconds.`
						: 'Try again in a minute.'),
			};
		default:
			if (status >= 500) {
				return {
					httpCode,
					message: 'Writ had a problem answering this call',
					description: (text ? `${text}. ` : '') + 'It was retried; try again in a moment.',
				};
			}
			return {
				httpCode,
				message: text || `Writ answered ${status}`,
				description: text ? `Writ answered ${status}.` : 'The request was refused.',
			};
	}
}
