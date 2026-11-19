import { describe, expect, it } from 'vitest';

import { describeWritError, errorText } from '../nodes/Writ/shared/errors';

describe('describeWritError', () => {
	it('tells a plan limit apart from missing credits on 402', () => {
		const ceiling = describeWritError(402, { detail: { message: 'Monitor limit reached', limit: 5 } });
		expect(ceiling.message).toBe('This call is over your Writ plan limit');
		expect(ceiling.description).toContain('allows 5');

		const credits = describeWritError(402, { detail: 'Not enough credits' });
		expect(credits.message).toBe('Not enough Writ credits for this call');
	});

	it('maps 401, 403 and 429 to what the user should do', () => {
		expect(describeWritError(401, { detail: 'Invalid API key' }).description).toContain('reconnect');
		expect(describeWritError(403, { detail: 'This API key lacks the crawl:execute scope' }).description).toContain(
			'crawl:execute',
		);
		expect(describeWritError(429, {}, 12).description).toContain('12 seconds');
		expect(describeWritError(503, null).message).toContain('problem');
	});

	it('reads every error body shape Writ answers with', () => {
		expect(errorText({ detail: 'plain' })).toBe('plain');
		expect(errorText({ detail: { error: 'code', message: 'Human words' } })).toBe('Human words');
		expect(errorText({ detail: [{ loc: ['body', 'url'], msg: 'field required' }] })).toBe('url: field required');
		expect(errorText({ error: 'invalid_grant', error_description: 'Code expired' })).toBe('Code expired');
		expect(errorText('text body')).toBe('text body');
		expect(errorText(undefined)).toBe('');
	});
});
