'use strict';

/**
 * Writ Cloud. WRIT_API_URL exists so the test suite can point the app at a local
 * server; the published app always talks to https://api.usewrit.app.
 */
const BASE_URL = (process.env.WRIT_API_URL || 'https://api.usewrit.app').replace(/\/+$/, '');

/** What the app may do, asked for once on the Writ consent screen. */
const SCOPES = [
  'account:read',
  'workflows:read',
  'workflows:execute',
  'runs:read',
  'datasets:read',
  'scrape:execute',
  'crawl:read',
  'crawl:execute',
  'monitors:read',
  'monitors:write',
  'monitors:execute',
  'triggers:read',
  'triggers:write',
  'triggers:delete',
];

const url = (path) => `${BASE_URL}${path}`;

module.exports = { BASE_URL, SCOPES, url };
