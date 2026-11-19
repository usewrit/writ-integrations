import { randomUUID } from 'crypto';
import {
	NodeApiError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type IHookFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type IPollFunctions,
	type JsonObject,
} from 'n8n-workflow';

import { describeWritError } from './errors';

/**
 * The one way every Writ node talks to the Writ API.
 *
 *  - Authentication goes through n8n (`httpRequestWithAuthentication`), so an OAuth2
 *    token is refreshed by n8n when Writ answers 401.
 *  - Every POST/PUT/PATCH/DELETE carries an `Idempotency-Key`, made once per call and
 *    kept across its retries: Writ replays the first answer instead of running the
 *    call twice, which is what makes retrying a write safe.
 *  - 408/425/429/5xx and dropped connections are retried with exponential backoff
 *    and full jitter, honouring `Retry-After` up to 30 seconds.
 *  - Errors become a NodeApiError whose message says what to do (errors.ts).
 */

export type WritContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IPollFunctions;

export type WritCredentialType = 'writApi' | 'writOAuth2Api';

export const DEFAULT_BASE_URL = 'https://api.usewrit.app';

const USER_AGENT = 'n8n-nodes-writ/0.1.1';
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 30_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export function credentialType(ctx: WritContext): WritCredentialType {
	const value =
		'getInputData' in ctx
			? (ctx as IExecuteFunctions).getNodeParameter('authentication', 0, 'apiKey')
			: (ctx as ILoadOptionsFunctions).getNodeParameter('authentication', 'apiKey');
	return value === 'oAuth2' ? 'writOAuth2Api' : 'writApi';
}

export async function baseUrl(ctx: WritContext): Promise<string> {
	const credentials = await ctx.getCredentials(credentialType(ctx));
	const raw = typeof credentials.baseUrl === 'string' && credentials.baseUrl ? credentials.baseUrl : DEFAULT_BASE_URL;
	return raw.replace(/\/+$/, '');
}

function backoffMs(attempt: number): number {
	const raw = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
	return raw / 2 + Math.random() * (raw / 2);
}

function retryAfterMs(headers: IDataObject | undefined): number | undefined {
	const raw = headers?.['retry-after'];
	if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) return seconds < 0 ? undefined : seconds * 1000;
	const when = Date.parse(String(raw));
	return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

interface FullResponse {
	statusCode: number;
	headers?: IDataObject;
	body: unknown;
}

export interface WritRequest {
	method: IHttpRequestMethods;
	path: string;
	body?: IDataObject;
	qs?: IDataObject;
	/** Answer with undefined instead of failing on 404 (a webhook that is already gone). */
	allowNotFound?: boolean;
	timeoutMs?: number;
}

export async function writRequest<T = unknown>(
	ctx: WritContext,
	request: WritRequest,
	itemIndex?: number,
): Promise<T> {
	const type = credentialType(ctx);
	const url = `${await baseUrl(ctx)}${request.path}`;
	const unsafe = request.method !== 'GET' && request.method !== 'HEAD';
	const headers: IDataObject = { Accept: 'application/json', 'User-Agent': USER_AGENT };
	if (unsafe) headers['Idempotency-Key'] = randomUUID();

	const options: IHttpRequestOptions = {
		method: request.method,
		url,
		headers,
		qs: request.qs,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: request.timeoutMs ?? 120_000,
	};
	if (request.body !== undefined) options.body = request.body;

	let last: FullResponse | undefined;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		let response: FullResponse;
		try {
			response = (await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				type,
				options,
			)) as FullResponse;
		} catch (error) {
			// A connection that never produced an answer. Every request here is safe to
			// repeat: reads by nature, writes because of the Idempotency-Key.
			if (attempt < MAX_ATTEMPTS) {
				await sleep(backoffMs(attempt));
				continue;
			}
			throw new NodeApiError(ctx.getNode(), error as JsonObject, {
				message: 'Could not reach Writ',
				description: `${url} did not answer. Check the API URL in the credential.`,
				itemIndex,
			});
		}

		const status = response.statusCode;
		if (status >= 200 && status < 300) return response.body as T;
		if (status === 404 && request.allowNotFound) return undefined as T;
		last = response;
		if (!RETRYABLE.has(status) || attempt === MAX_ATTEMPTS) break;
		const wait = retryAfterMs(response.headers);
		if (wait !== undefined && wait > MAX_RETRY_AFTER_MS) break;
		await sleep(wait ?? backoffMs(attempt));
	}

	const status = last?.statusCode ?? 0;
	const retryAfter = retryAfterMs(last?.headers);
	const info = describeWritError(
		status,
		last?.body,
		retryAfter !== undefined ? retryAfter / 1000 : undefined,
	);
	throw new NodeApiError(
		ctx.getNode(),
		{ status, body: (last?.body ?? null) as JsonObject } as JsonObject,
		{ ...info, itemIndex },
	);
}

/** Sleep in n8n's own way (community nodes may not use timers directly). */
export async function pause(ms: number): Promise<void> {
	await sleep(ms);
}
