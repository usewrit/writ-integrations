/**
 * The app against a real Writ server. Runs only with WRIT_E2E=1 and:
 *   WRIT_API_URL, CLIENT_ID, CLIENT_SECRET    the server and the Zapier OAuth app on it
 *   WRIT_TEST_AUTH_CODE, WRIT_TEST_CODE_VERIFIER, WRIT_TEST_REDIRECT_URI
 *                                             a fresh code the test user approved (PKCE)
 *   WRIT_TEST_API_KEY                         an API key of the same account, to look
 *                                             at its webhook subscriptions directly
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const live = process.env.WRIT_E2E === '1';

describe.runIf(live)('live against a Writ server', () => {
  const zapier = require('zapier-platform-core');
  const App = require('../index');
  const appTester = zapier.createAppTester(App);
  const { signPayload } = require('../lib/signature');
  const base = process.env.WRIT_API_URL;
  const authData = {};

  const withKey = (path, init = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.WRIT_TEST_API_KEY}`, ...(init.headers || {}) } });

  it('exchanges the authorization code, refreshes, and tests the connection', async () => {
    const tokens = await appTester(App.authentication.oauth2Config.getAccessToken, {
      inputData: {
        code: process.env.WRIT_TEST_AUTH_CODE,
        code_verifier: process.env.WRIT_TEST_CODE_VERIFIER,
        redirect_uri: process.env.WRIT_TEST_REDIRECT_URI,
      },
    });
    expect(tokens.access_token).toMatch(/^wto_/);
    expect(tokens.refresh_token).toMatch(/^wtr_/);
    const refreshed = await appTester(App.authentication.oauth2Config.refreshAccessToken, { authData: tokens });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    Object.assign(authData, refreshed);
    const me = await appTester(App.authentication.test, { authData });
    expect(me.email).toBeTruthy();
  });

  it('runs every action and search', async () => {
    const page = await appTester(App.creates.scrape_page.operation.perform, { authData, inputData: { url: 'https://example.com', format: 'markdown' } });
    expect(page.title).toBe('Example Domain');
    const map = await appTester(App.creates.map_site.operation.perform, { authData, inputData: { url: 'https://example.com', limit: '5' } });
    expect(map.count).toBeGreaterThan(0);
    const monitor = await appTester(App.creates.create_monitor.operation.perform, { authData, inputData: { url: 'https://example.com/zapier-live', check_type: 'content' } });
    expect(monitor.id).toBeGreaterThan(0);
    const check = await appTester(App.creates.check_monitor.operation.perform, { authData, inputData: { monitor_id: monitor.id } });
    expect(check.monitor_id).toBe(monitor.id);
    const found = await appTester(App.searches.find_monitor.operation.perform, { authData, inputData: { query: 'zapier-live' } });
    expect(found.map((m) => m.id)).toContain(monitor.id);
    const crawl = await appTester(App.creates.start_crawl.operation.perform, { authData, inputData: { url: 'https://example.com', page_budget: '2' } });
    expect(crawl.id).toBeGreaterThan(0);
    const records = await appTester(App.searches.find_records.operation.perform, { authData, inputData: { workflow_id: crawl.data_workflow_id, query: 'x' } });
    expect(Array.isArray(records)).toBe(true);
    expect(Array.isArray(await appTester(App.searches.find_workflow.operation.perform, { authData, inputData: { name: 'a' } }))).toBe(true);
    for (const key of ['change_detected', 'workflow_completed', 'crawl_finished', 'monitor_health']) {
      expect(Array.isArray(await appTester(App.triggers[key].operation.performList, { authData, inputData: {} }))).toBe(true);
    }
    await expect(
      appTester(App.creates.run_workflow.operation.perform, { authData, inputData: { workflow_id: 99999999, wait: false } }),
    ).rejects.toThrow();
  });

  it('subscribes, receives a signed delivery, unsubscribes; a revoke removes what the app made', async () => {
    const targetUrl = 'https://hooks.zapier.com/hooks/standard/0/writ-live-test/';
    const sub = await appTester(App.triggers.workflow_completed.operation.performSubscribe, { authData, targetUrl, inputData: {}, meta: { zap: { id: 4242 } } });
    let rows = (await (await withKey('/api/webhooks/recipients')).json()).recipients;
    const row = rows.find((r) => r.id === sub.id);
    expect(row).toMatchObject({ integration: 'zapier', external_ref: '4242', created_via: 'oauth', event_types: ['workflow_completed'] });

    const payload = { event: 'workflow_completed', event_id: 'evt_live', data: { workflow: { id: 1, name: 'W' }, run: { id: 5, status: 'success', success: true } } };
    const content = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const items = await appTester(App.triggers.workflow_completed.operation.perform, {
      authData, inputData: {}, subscribeData: sub, cleanedRequest: payload,
      rawRequest: { content, headers: { 'Http-X-Writ-Timestamp': timestamp, 'Http-X-Writ-Signature-V1': signPayload(sub.secret, timestamp, content) } },
    });
    expect(items[0]).toMatchObject({ id: 5, success: true });

    await appTester(App.triggers.workflow_completed.operation.performUnsubscribe, { authData, subscribeData: sub });
    rows = (await (await withKey('/api/webhooks/recipients')).json()).recipients;
    expect(rows.find((r) => r.id === sub.id)).toBeUndefined();

    // A subscription left behind (a Zap deleted while Writ was unreachable) goes when
    // the person disconnects Zapier from Writ.
    const orphan = await appTester(App.triggers.crawl_finished.operation.performSubscribe, { authData, targetUrl, inputData: { outcome: 'both' } });
    const revoke = await fetch(`${base}/api/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: authData.refresh_token, token_type_hint: 'refresh_token', client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET }),
    });
    expect(revoke.status).toBe(200);
    rows = (await (await withKey('/api/webhooks/recipients')).json()).recipients;
    expect(rows.find((r) => r.id === orphan.id)).toBeUndefined();
    await expect(appTester(App.authentication.test, { authData })).rejects.toMatchObject({ name: 'RefreshAuthError' });
  });
});
