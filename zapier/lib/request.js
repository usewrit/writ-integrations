'use strict';

const crypto = require('crypto');
const { describeWritError } = require('./errors');

const USER_AGENT = 'writ-zapier/0.1.0';

/** Every request: the OAuth token, JSON, and an Idempotency-Key on writes (Writ replays
 * the first answer to a repeated key instead of running the call twice). */
function addHeaders(request, z, bundle) {
  request.headers = request.headers || {};
  if (bundle.authData && bundle.authData.access_token) {
    request.headers.Authorization = `Bearer ${bundle.authData.access_token}`;
  }
  request.headers.Accept = request.headers.Accept || 'application/json';
  request.headers['User-Agent'] = USER_AGENT;
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !request.headers['Idempotency-Key']) {
    request.headers['Idempotency-Key'] = crypto.randomUUID();
  }
  return request;
}

function parsedBody(response) {
  if (response.data !== undefined) return response.data;
  try {
    return JSON.parse(response.content);
  } catch (e) {
    return response.content;
  }
}

/** Turn a Writ error into the Zapier error that tells the user what to do. */
function handleErrors(response, z) {
  if (response.status < 400 || response.skipThrowForStatus) return response;
  const retryAfter = Number(response.getHeader && response.getHeader('retry-after'));
  const info = describeWritError(response.status, parsedBody(response), Number.isFinite(retryAfter) ? retryAfter : undefined);
  if (info.kind === 'auth') throw new z.errors.RefreshAuthError(info.message);
  if (info.kind === 'throttle') throw new z.errors.ThrottledError(info.message, info.retryAfter);
  throw new z.errors.Error(info.message, `writ_${response.status}`, response.status);
}

module.exports = { addHeaders, handleErrors };
