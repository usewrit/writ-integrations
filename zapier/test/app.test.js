/**
 * Every trigger, action and search against a stand-in Writ API on localhost, so the
 * suite runs anywhere (CI included). live.test.js runs the same app against a real
 * Writ server when WRIT_E2E=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import http from 'http';

const require = createRequire(import.meta.url);
const { signPayload } = require('../lib/signature');

const calls = [];
let server;
let App;
let appTester;
let taskReads = 0;

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

function route(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const key = `${req.method} ${u.pathname}`;
  calls.push({ key, query: Object.fromEntries(u.searchParams), body, headers: req.headers });
  switch (key) {
    case 'GET /api/auth/me': return json(res, 200, { email: 'person@example.com' });
    case 'GET /api/automation/workflows': return json(res, 200, [{ id: 1, name: 'HN front page' }, { id: 2, name: 'Harvest: x', workflow_type: 'crawl' }]);
    case 'GET /api/targets': return json(res, 200, [{ id: 4, url: 'https://example.com/pricing', name: 'Pricing' }, { id: 5, url: 'https://other.example' }]);
    case 'GET /api/targets/changes/recent': return json(res, 200, [
      { id: 91, target_id: 4, target_url: 'https://example.com/pricing', diff_snippet: '-49 +59', first_detected_at: '2026-11-19T10:00:00Z', last_detected_at: '2026-11-19T10:00:00Z' },
      { id: 92, target_id: 5, target_url: 'https://other.example', last_detected_at: '2026-11-19T09:00:00Z' },
    ]);
    case 'GET /api/automation/tasks': return json(res, 200, [
      { id: 7, workflow_id: 1, status: 'success', success: true, result_data: { extracted_data: [{ t: 1 }] } },
      { id: 8, workflow_id: 1, status: 'running' },
      { id: 9, workflow_id: 1, status: 'failed', success: false, error_message: 'Site refused' },
    ]);
    case 'GET /api/crawl': return json(res, 200, [{ id: 31, status: 'completed', name: 'c', workflow_id: 77 }, { id: 32, status: 'failed', error: 'x' }, { id: 33, status: 'running' }]);
    case 'POST /api/webhooks/recipients': return json(res, 200, { success: true, recipient: { id: 11, url: body.url } });
    case 'DELETE /api/webhooks/recipients/11': return json(res, 200, { success: true });
    case 'DELETE /api/webhooks/recipients/12': return json(res, 404, { detail: 'Webhook recipient not found' });
    case 'POST /api/crawl/scrape': return json(res, 200, { url: body.url, title: 'Example', format: body.format, markdown: '# Hi', engine: 'inline' });
    case 'POST /api/crawl/map': return json(res, 200, { urls: [{ url: body.url, title: 'Home', score: 1 }], count: 1 });
    case 'POST /api/crawl': return json(res, 200, { id: 40, name: 'Harvest', seed_url: body.url, status: 'queued', workflow_id: 78 });
    case 'POST /api/targets': return json(res, 201, { id: 6, url: body.url, checkType: body.check_type, enabled: true });
    case 'POST /api/targets/4/run': return json(res, 200, { ok: true, dispatched: 1 });
    case 'POST /api/automation/workflows/1/run': taskReads = 0; return json(res, 200, { task_id: 70, status: 'queued' });
    case 'GET /api/automation/tasks/70':
      taskReads += 1;
      return json(res, 200, taskReads < 2 ? { id: 70, status: 'running' } : { id: 70, workflow_id: 1, status: 'success', success: true, result_data: { extracted_data: [{ price: 59 }] } });
    case 'POST /api/automation/workflows/402/run': return json(res, 402, { detail: { message: 'Run limit reached', limit: 5 } });
    case 'POST /api/automation/workflows/403/run': return json(res, 402, { detail: 'Insufficient credits' });
    case 'POST /api/automation/workflows/401/run': return json(res, 401, { detail: 'Token revoked' });
    case 'POST /api/automation/workflows/429/run': return json(res, 429, { detail: 'Plan API rate limit exceeded' }, { 'retry-after': '42' });
    case 'GET /api/v1/workflows/1/data': return json(res, 200, { rows: [{ id: 'r1', title: 'Laptop', price: 999 }] });
    default: return json(res, 404, { detail: `no route ${key}` });
  }
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      route(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.WRIT_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.CLIENT_ID = 'test-client';
  process.env.CLIENT_SECRET = 'test-secret';
  const zapier = require('zapier-platform-core');
  App = require('../index');
  appTester = zapier.createAppTester(App);
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const authData = { access_token: 'wto_test', refresh_token: 'wtr_test' };
const last = (key) => [...calls].reverse().find((call) => call.key === key);

describe('authentication', () => {
  it('tests the connection with /api/auth/me and labels it by email', async () => {
    const me = await appTester(App.authentication.test, { authData });
    expect(me.email).toBe('person@example.com');
    expect(last('GET /api/auth/me').headers.authorization).toBe('Bearer wto_test');
  });
  it('asks for the scopes Writ will show on its consent screen', () => {
    const scope = App.authentication.oauth2Config.authorizeUrl.params.scope;
    expect(scope).toContain('scrape:execute');
    expect(scope).toContain('triggers:delete');
    expect(App.authentication.oauth2Config.enablePkce).toBe(true);
  });
});

describe('hidden pickers', () => {
  it('lists workflows without crawl workflows, and monitors', async () => {
    expect(await appTester(App.triggers.workflow_list.operation.perform, { authData })).toEqual([{ id: 1, name: 'HN front page' }]);
    const monitors = await appTester(App.triggers.monitor_list.operation.perform, { authData });
    expect(monitors.map((m) => m.id)).toEqual([4, 5]);
  });
});

describe('REST hook triggers', () => {
  it('subscribes with a fresh secret, the event and the Zap id', async () => {
    const sub = await appTester(App.triggers.workflow_completed.operation.performSubscribe, {
      authData, targetUrl: 'https://hooks.zapier.com/hooks/standard/1/abc', inputData: {}, meta: { zap: { id: 555 } },
    });
    expect(sub.id).toBe(11);
    expect(sub.secret).toMatch(/^[0-9a-f]{64}$/);
    const sent = last('POST /api/webhooks/recipients');
    expect(sent.body).toMatchObject({
      url: 'https://hooks.zapier.com/hooks/standard/1/abc', event_types: ['workflow_completed'],
      integration: 'zapier', external_ref: '555', secret: sub.secret,
    });
    expect(sent.headers['idempotency-key']).toBeTruthy();
  });

  it('subscribes the crawl and monitor-status triggers to the chosen events', async () => {
    await appTester(App.triggers.crawl_finished.operation.performSubscribe, { authData, targetUrl: 'https://h/x', inputData: { outcome: 'both' } });
    expect(last('POST /api/webhooks/recipients').body.event_types).toEqual(['crawl_completed', 'crawl_failed']);
    await appTester(App.triggers.monitor_health.operation.performSubscribe, { authData, targetUrl: 'https://h/x', inputData: { events: ['monitor_stale'] } });
    expect(last('POST /api/webhooks/recipients').body.event_types).toEqual(['monitor_stale']);
    await appTester(App.triggers.change_detected.operation.performSubscribe, { authData, targetUrl: 'https://h/x', inputData: {} });
    expect(last('POST /api/webhooks/recipients').body.event_types).toEqual(['change_detected']);
  });

  it('unsubscribes, and an already removed subscription is not an error', async () => {
    await appTester(App.triggers.workflow_completed.operation.performUnsubscribe, { authData, subscribeData: { id: 11 } });
    expect(last('DELETE /api/webhooks/recipients/11')).toBeTruthy();
    await expect(appTester(App.triggers.workflow_completed.operation.performUnsubscribe, { authData, subscribeData: { id: 12 } })).resolves.toEqual({});
  });

  const deliver = (payload, secret, signWith = secret) => {
    const content = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return {
      authData,
      subscribeData: { id: 11, secret },
      cleanedRequest: payload,
      rawRequest: { content, headers: { 'Http-X-Writ-Timestamp': timestamp, 'Http-X-Writ-Signature-V1': signPayload(signWith, timestamp, content) } },
      inputData: {},
    };
  };

  it('emits a signed delivery and refuses a forged one', async () => {
    const payload = { event: 'workflow_completed', event_id: 'evt_9', data: { workflow: { id: 1, name: 'HN' }, run: { id: 70, status: 'success', success: true }, extracted_data: [{ a: 1 }] } };
    const items = await appTester(App.triggers.workflow_completed.operation.perform, deliver(payload, 's3cret'));
    expect(items).toEqual([expect.objectContaining({ id: 70, workflow_id: 1, success: true, extracted_data_json: '[{"a":1}]' })]);
    await expect(appTester(App.triggers.workflow_completed.operation.perform, deliver(payload, 's3cret', 'forged'))).rejects.toThrow(/did not sign/);
  });

  it('drops deliveries the Zap filtered out', async () => {
    const payload = { event: 'workflow_completed', event_id: 'evt_9', data: { workflow: { id: 2 }, run: { id: 71, status: 'failed', success: false } } };
    const bundle = deliver(payload, 's');
    bundle.inputData = { workflow_id: 1 };
    expect(await appTester(App.triggers.workflow_completed.operation.perform, bundle)).toEqual([]);
    bundle.inputData = { outcome: 'success' };
    expect(await appTester(App.triggers.workflow_completed.operation.perform, bundle)).toEqual([]);
    const other = deliver({ event: 'crawl_failed', data: {} }, 's');
    expect(await appTester(App.triggers.workflow_completed.operation.perform, other)).toEqual([]);
  });

  it('maps change and monitor-status deliveries', async () => {
    const change = await appTester(App.triggers.change_detected.operation.perform, deliver({
      event: 'change_detected', event_id: 'evt_c', target: { id: 4, url: 'https://example.com/pricing', name: 'Pricing' },
      change: { id: 91, content_before: 'a', content_after: 'b', content_truncated: false },
    }, 's'));
    expect(change[0]).toMatchObject({ id: 91, monitor_id: 4, content_after: 'b' });
    const health = await appTester(App.triggers.monitor_health.operation.perform, {
      ...deliver({ event: 'monitor_down', event_id: 'evt_h', data: { monitor: { id: 4, url: 'u' }, state: 'down', status_code: 503 } }, 's'),
      inputData: { events: ['monitor_down'] },
    });
    expect(health[0]).toMatchObject({ id: 'evt_h', state: 'down', status_code: 503 });
  });

  it('lists real data for samples, filtered like the hook', async () => {
    const changes = await appTester(App.triggers.change_detected.operation.performList, { authData, inputData: { monitor_id: 4 } });
    expect(changes.map((c) => c.id)).toEqual([91]);
    const runs = await appTester(App.triggers.workflow_completed.operation.performList, { authData, inputData: { workflow_id: 1 } });
    expect(runs.map((r) => r.id)).toEqual([7, 9]);
    expect(last('GET /api/automation/tasks').query.workflow_id).toBe('1');
    const crawls = await appTester(App.triggers.crawl_finished.operation.performList, { authData, inputData: { outcome: 'completed' } });
    expect(crawls.map((c) => c.id)).toEqual([31]);
    const health = await appTester(App.triggers.monitor_health.operation.performList, { authData, inputData: {} });
    expect(health).toHaveLength(1);
  });
});

describe('actions', () => {
  it('scrapes, maps and starts a crawl', async () => {
    const page = await appTester(App.creates.scrape_page.operation.perform, { authData, inputData: { url: 'https://example.com', format: 'markdown' } });
    expect(page).toMatchObject({ title: 'Example', markdown: '# Hi' });
    const map = await appTester(App.creates.map_site.operation.perform, { authData, inputData: { url: 'https://example.com', limit: '9999' } });
    expect(map.count).toBe(1);
    expect(last('POST /api/crawl/map').body.limit).toBe(500);
    const crawl = await appTester(App.creates.start_crawl.operation.perform, { authData, inputData: { url: 'https://example.com', page_budget: '20', include_paths: ['/docs/*'] } });
    expect(crawl).toMatchObject({ id: 40, status: 'queued', data_workflow_id: 78 });
    expect(last('POST /api/crawl').body).toEqual({ url: 'https://example.com', page_budget: 20, include_paths: ['/docs/*'] });
  });

  it('runs a workflow and waits for its result', async () => {
    const run = await appTester(App.creates.run_workflow.operation.perform, { authData, inputData: { workflow_id: 1, inputs: { query: 'laptops' } } });
    expect(run).toMatchObject({ id: 70, finished: true, success: true, extracted_data: [{ price: 59 }] });
    expect(last('POST /api/automation/workflows/1/run').body).toEqual({ form_data: { query: 'laptops' } });
    const handle = await appTester(App.creates.run_workflow.operation.perform, { authData, inputData: { workflow_id: 1, wait: false } });
    expect(handle).toMatchObject({ id: 70, finished: false });
  });

  it('creates and checks a monitor', async () => {
    const monitor = await appTester(App.creates.create_monitor.operation.perform, { authData, inputData: { url: 'https://e.com', check_type: 'content', check_every_minutes: '15' } });
    expect(monitor).toMatchObject({ id: 6, check_type: 'content' });
    expect(last('POST /api/targets').body.check_period_ms).toBe(900000);
    const check = await appTester(App.creates.check_monitor.operation.perform, { authData, inputData: { monitor_id: 4 } });
    expect(check).toMatchObject({ monitor_id: 4, queued: true, dispatched: 1 });
  });

  it('turns Writ errors into what the user should do', async () => {
    const run = (id) => appTester(App.creates.run_workflow.operation.perform, { authData, inputData: { workflow_id: id, wait: false } });
    await expect(run(402)).rejects.toThrow(/plan's limit of 5/);
    await expect(run(403)).rejects.toThrow(/Not enough Writ credits/);
    await expect(run(401)).rejects.toMatchObject({ name: 'RefreshAuthError' });
    await expect(run(429)).rejects.toMatchObject({ name: 'ThrottledError' });
  });
});

describe('searches', () => {
  it('finds workflows, monitors and records', async () => {
    expect(await appTester(App.searches.find_workflow.operation.perform, { authData, inputData: { name: 'hn' } })).toEqual([
      { id: 1, name: 'HN front page', description: null },
    ]);
    const monitors = await appTester(App.searches.find_monitor.operation.perform, { authData, inputData: { query: 'pricing' } });
    expect(monitors.map((m) => m.id)).toEqual([4]);
    const rows = await appTester(App.searches.find_records.operation.perform, { authData, inputData: { workflow_id: 1, query: 'lap' } });
    expect(rows[0]).toMatchObject({ id: 'r1', title: 'Laptop' });
    expect(last('GET /api/v1/workflows/1/data').query).toMatchObject({ q: 'lap', limit: '25' });
  });
});
