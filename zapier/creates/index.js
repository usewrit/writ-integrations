'use strict';

const { url } = require('../lib/config');
const n = require('../lib/normalize');

const TERMINAL = ['success', 'failed', 'cancelled', 'canceled', 'timeout', 'error'];
/** Zapier gives an action about 30 seconds; a run still going after this is returned as running. */
const MAX_WAIT_MS = 22000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const workflowPicker = {
  key: 'workflow_id',
  label: 'Workflow',
  type: 'integer',
  dynamic: 'workflow_list.id.name',
  required: true,
  helpText: 'A workflow saved in Writ (a website turned into an API).',
};
const monitorPicker = { key: 'monitor_id', label: 'Monitor', type: 'integer', dynamic: 'monitor_list.id.name', required: true };

const scrapePage = {
  key: 'scrape_page',
  noun: 'Page',
  display: { label: 'Scrape Page', description: 'Reads one web page as clean markdown or HTML.' },
  operation: {
    inputFields: [
      { key: 'url', label: 'URL', required: true, helpText: 'The page to read.' },
      { key: 'format', label: 'Format', choices: { markdown: 'Markdown', html: 'HTML', both: 'Both' }, default: 'markdown', required: true },
      {
        key: 'render_mode',
        label: 'Render Mode',
        choices: { auto: 'Auto (browser only when needed)', browser: 'Always a browser', http: 'Plain fetch only' },
        default: 'auto',
        required: false,
      },
    ],
    perform: async (z, bundle) => {
      const body = { url: bundle.inputData.url, format: bundle.inputData.format || 'markdown' };
      if (bundle.inputData.render_mode) body.render_mode = bundle.inputData.render_mode;
      const response = await z.request({ url: url('/api/crawl/scrape'), method: 'POST', body });
      const page = response.data || {};
      return { url: page.url, title: page.title ?? null, format: page.format, markdown: page.markdown ?? null, html: page.html ?? null, engine: page.engine ?? null };
    },
    sample: {
      url: 'https://example.com',
      title: 'Example Domain',
      format: 'markdown',
      markdown: 'This domain is for use in documentation examples without needing permission.',
      html: null,
      engine: 'inline',
    },
    outputFields: [
      { key: 'url', label: 'URL' },
      { key: 'title', label: 'Title' },
      { key: 'format', label: 'Format' },
      { key: 'markdown', label: 'Markdown' },
      { key: 'html', label: 'HTML' },
      { key: 'engine', label: 'Engine' },
    ],
  },
};

const mapSite = {
  key: 'map_site',
  noun: 'Site Map',
  display: { label: 'Map Site', description: "Lists a site's pages, ranked by a search phrase when you give one." },
  operation: {
    inputFields: [
      { key: 'url', label: 'Site URL', required: true },
      { key: 'search', label: 'Search', required: false, helpText: 'Rank the pages by relevance to this phrase.' },
      { key: 'limit', label: 'Limit', type: 'integer', default: '50', required: false },
    ],
    perform: async (z, bundle) => {
      const body = { url: bundle.inputData.url, limit: Math.min(Math.max(Number(bundle.inputData.limit) || 50, 1), 500) };
      if (bundle.inputData.search) body.search = bundle.inputData.search;
      const response = await z.request({ url: url('/api/crawl/map'), method: 'POST', body });
      const urls = (response.data && response.data.urls) || [];
      return { count: urls.length, urls: urls.map((entry) => ({ url: entry.url, title: entry.title ?? null, score: entry.score ?? null })) };
    },
    sample: { count: 1, urls: [{ url: 'https://example.com', title: 'Example Domain', score: 0 }] },
    outputFields: [
      { key: 'count', label: 'Count', type: 'integer' },
      { key: 'urls[]url', label: 'URL' },
      { key: 'urls[]title', label: 'Title' },
      { key: 'urls[]score', label: 'Score', type: 'number' },
    ],
  },
};

const startCrawl = {
  key: 'start_crawl',
  noun: 'Crawl',
  display: { label: 'Start Crawl', description: 'Crawls a site from a starting URL. Use the "Crawl Finished" trigger to act on the result.' },
  operation: {
    inputFields: [
      { key: 'url', label: 'Starting URL', required: true },
      { key: 'page_budget', label: 'Page Budget', type: 'integer', default: '100', required: true, helpText: 'Most pages to read.' },
      { key: 'intent', label: 'Goal', required: false, helpText: 'What the crawl is for, in plain words. Writ reads the most relevant pages first.' },
      { key: 'include_paths', label: 'Include Paths', list: true, required: false },
      { key: 'exclude_paths', label: 'Exclude Paths', list: true, required: false },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData;
      const body = { url: input.url, page_budget: Math.min(Math.max(Number(input.page_budget) || 100, 1), 50000) };
      if (input.intent) body.intent = input.intent;
      if (input.include_paths && input.include_paths.length) body.include_paths = input.include_paths;
      if (input.exclude_paths && input.exclude_paths.length) body.exclude_paths = input.exclude_paths;
      const response = await z.request({ url: url('/api/crawl'), method: 'POST', body });
      return n.crawlFromJob(response.data || {});
    },
    sample: {
      id: 5521,
      event_id: null,
      name: 'Harvest: docs.example.com',
      seed_url: 'https://docs.example.com/',
      status: 'queued',
      pages_done: 0,
      pages_failed: 0,
      pages_discovered: 0,
      error: null,
      data_workflow_id: 901,
    },
    outputFields: [
      { key: 'id', label: 'Crawl ID', type: 'integer' },
      { key: 'name', label: 'Name' },
      { key: 'seed_url', label: 'Starting URL' },
      { key: 'status', label: 'Status' },
      { key: 'data_workflow_id', label: 'Data Workflow ID', type: 'integer' },
    ],
  },
};

const runWorkflow = {
  key: 'run_workflow',
  noun: 'Run',
  display: { label: 'Run Workflow', description: 'Runs a saved Writ workflow with inputs and returns the data it extracted.' },
  operation: {
    inputFields: [
      workflowPicker,
      { key: 'inputs', label: 'Inputs', dict: true, required: false, helpText: "The workflow's input values, by input name." },
      { key: 'function_name', label: 'Function', required: false, helpText: 'For a workflow with several functions, the one to call.' },
      {
        key: 'wait',
        label: 'Wait for the Result',
        type: 'boolean',
        default: 'true',
        required: false,
        helpText: 'Wait up to 20 seconds for the run. A longer run is returned as running; the "Workflow Run Finished" trigger receives its result.',
      },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData;
      const body = { form_data: input.inputs || {} };
      if (input.function_name) body.function_name = input.function_name;
      const started = await z.request({ url: url(`/api/automation/workflows/${input.workflow_id}/run`), method: 'POST', body });
      const taskId = started.data && started.data.task_id;
      const handle = { id: taskId, workflow_id: Number(input.workflow_id), status: (started.data && started.data.status) || 'queued', finished: false };
      if (!taskId || input.wait === false || input.wait === 'false') return handle;
      const deadline = Date.now() + MAX_WAIT_MS;
      let delay = 1500;
      while (Date.now() + delay < deadline) {
        await wait(delay);
        delay = Math.min(delay * 1.5, 5000);
        const task = (await z.request({ url: url(`/api/automation/tasks/${taskId}`) })).data || {};
        if (TERMINAL.includes(task.status)) return { ...n.runFromTask(task), finished: true };
      }
      return handle;
    },
    sample: {
      id: 77120,
      event_id: null,
      workflow_id: 318,
      workflow_name: null,
      status: 'success',
      success: true,
      error: null,
      duration_ms: 8420,
      completed_at: '2026-11-19T14:03:00Z',
      extracted_data: [{ title: 'Show HN: Writ', points: 128 }],
      extracted_data_json: '[{"title":"Show HN: Writ","points":128}]',
      data_truncated: false,
      finished: true,
    },
    outputFields: [
      { key: 'id', label: 'Run ID', type: 'integer' },
      { key: 'workflow_id', label: 'Workflow ID', type: 'integer' },
      { key: 'status', label: 'Status' },
      { key: 'success', label: 'Success', type: 'boolean' },
      { key: 'finished', label: 'Finished', type: 'boolean' },
      { key: 'error', label: 'Error' },
      { key: 'extracted_data', label: 'Extracted Data', list: true },
  { key: 'extracted_data_json', label: 'Extracted Data (JSON)' },
    ],
  },
};

const createMonitor = {
  key: 'create_monitor',
  noun: 'Monitor',
  display: { label: 'Create Monitor', description: 'Starts watching a page for changes.' },
  operation: {
    inputFields: [
      { key: 'url', label: 'URL', required: true },
      { key: 'check_type', label: 'Watch For', choices: { content: 'Content changes', uptime: 'The page going down' }, default: 'content', required: true },
      { key: 'selector', label: 'CSS Selector', required: false, helpText: 'Watch only this part of the page.' },
      { key: 'check_every_minutes', label: 'Check Every (Minutes)', type: 'integer', default: '60', required: false },
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData;
      const body = { url: input.url, check_type: input.check_type || 'content' };
      if (input.selector) body.selector = input.selector;
      if (input.check_every_minutes) body.check_period_ms = Math.max(Number(input.check_every_minutes), 1) * 60000;
      const response = await z.request({ url: url('/api/targets'), method: 'POST', body });
      const monitor = response.data || {};
      return { id: monitor.id, url: monitor.url, check_type: monitor.checkType ?? body.check_type, enabled: monitor.enabled ?? true };
    },
    sample: { id: 42, url: 'https://example.com/pricing', check_type: 'content', enabled: true },
    outputFields: [
      { key: 'id', label: 'Monitor ID', type: 'integer' },
      { key: 'url', label: 'URL' },
      { key: 'check_type', label: 'Watch For' },
      { key: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
  },
};

const checkMonitor = {
  key: 'check_monitor',
  noun: 'Check',
  display: { label: 'Check Monitor Now', description: 'Queues a check of a monitor right away.' },
  operation: {
    inputFields: [monitorPicker],
    perform: async (z, bundle) => {
      const response = await z.request({ url: url(`/api/targets/${bundle.inputData.monitor_id}/run`), method: 'POST' });
      const answer = response.data || {};
      return { monitor_id: Number(bundle.inputData.monitor_id), queued: Boolean(answer.ok), dispatched: answer.dispatched ?? 0, detail: answer.detail ?? null };
    },
    sample: { monitor_id: 42, queued: true, dispatched: 1, detail: null },
    outputFields: [
      { key: 'monitor_id', label: 'Monitor ID', type: 'integer' },
      { key: 'queued', label: 'Queued', type: 'boolean' },
      { key: 'dispatched', label: 'Checks Sent', type: 'integer' },
      { key: 'detail', label: 'Detail' },
    ],
  },
};

module.exports = { scrapePage, mapSite, startCrawl, runWorkflow, createMonitor, checkMonitor };
