'use strict';

const { url } = require('../lib/config');
const { hookOperation } = require('../lib/hooks');
const n = require('../lib/normalize');

const monitorPicker = {
  key: 'monitor_id',
  label: 'Monitor',
  type: 'integer',
  dynamic: 'monitor_list.id.name',
  required: false,
  helpText: 'Only this monitor. Leave empty for every monitor in the account.',
};

const sameMonitor = (bundle, item) => !bundle.inputData.monitor_id || Number(item.monitor_id) === Number(bundle.inputData.monitor_id);

const changeOutput = [
  { key: 'id', label: 'Change ID', type: 'integer' },
  { key: 'monitor_id', label: 'Monitor ID', type: 'integer' },
  { key: 'monitor_name', label: 'Monitor Name' },
  { key: 'monitor_url', label: 'Monitor URL' },
  { key: 'detected_at', label: 'Detected At', type: 'datetime' },
  { key: 'content_before', label: 'Content Before' },
  { key: 'content_after', label: 'Content After' },
  { key: 'content_truncated', label: 'Content Truncated', type: 'boolean' },
  { key: 'diff', label: 'Diff' },
];

const newChange = {
  key: 'change_detected',
  noun: 'Change',
  display: {
    label: 'New Change Detected',
    description: 'Triggers when a Writ monitor detects that a page changed. A change detected again later triggers again.',
  },
  operation: hookOperation({
    label: 'change detected',
    events: () => ['change_detected'],
    fromHook: n.changeFromHook,
    accept: sameMonitor,
    inputFields: [monitorPicker],
    list: async (z, bundle) => {
      const response = await z.request({ url: url('/api/targets/changes/recent'), params: { limit: 25 } });
      return (Array.isArray(response.data) ? response.data : []).map(n.changeFromFeed).filter((item) => sameMonitor(bundle, item));
    },
    sample: {
      id: 9182,
      event_id: 'evt_3f1c9a0e5b7d4c2a8e6f1b0d9c7a5e3f',
      monitor_id: 42,
      monitor_name: 'Example pricing',
      monitor_url: 'https://example.com/pricing',
      detected_at: '2026-11-19T14:03:00Z',
      content_before: 'Pro plan: $49/month',
      content_after: 'Pro plan: $59/month',
      content_truncated: false,
      diff: null,
    },
    outputFields: changeOutput,
  }),
};

const runOutput = [
  { key: 'id', label: 'Run ID', type: 'integer' },
  { key: 'workflow_id', label: 'Workflow ID', type: 'integer' },
  { key: 'workflow_name', label: 'Workflow Name' },
  { key: 'status', label: 'Status' },
  { key: 'success', label: 'Success', type: 'boolean' },
  { key: 'error', label: 'Error' },
  { key: 'duration_ms', label: 'Duration (ms)', type: 'integer' },
  { key: 'completed_at', label: 'Completed At', type: 'datetime' },
  { key: 'extracted_data', label: 'Extracted Data', list: true },
  { key: 'extracted_data_json', label: 'Extracted Data (JSON)' },
  { key: 'data_truncated', label: 'Data Truncated', type: 'boolean' },
];

const runFilter = (bundle, item) => {
  if (bundle.inputData.workflow_id && Number(item.workflow_id) !== Number(bundle.inputData.workflow_id)) return false;
  const outcome = bundle.inputData.outcome || 'any';
  if (outcome === 'success') return item.success === true;
  if (outcome === 'failed') return item.success !== true;
  return true;
};

const runFinished = {
  key: 'workflow_completed',
  noun: 'Run',
  display: {
    label: 'Workflow Run Finished',
    description: 'Triggers when a run of a Writ workflow finishes, with the data it extracted.',
  },
  operation: hookOperation({
    label: 'workflow run finished',
    events: () => ['workflow_completed'],
    fromHook: n.runFromHook,
    accept: runFilter,
    inputFields: [
      {
        key: 'workflow_id',
        label: 'Workflow',
        type: 'integer',
        dynamic: 'workflow_list.id.name',
        required: false,
        helpText: 'Only runs of this workflow. Leave empty for every workflow.',
      },
      {
        key: 'outcome',
        label: 'Outcome',
        choices: { any: 'Any run', success: 'Successful runs only', failed: 'Failed runs only' },
        default: 'any',
        required: false,
      },
    ],
    list: async (z, bundle) => {
      const params = { limit: 25 };
      if (bundle.inputData.workflow_id) params.workflow_id = bundle.inputData.workflow_id;
      const response = await z.request({ url: url('/api/automation/tasks'), params });
      return (Array.isArray(response.data) ? response.data : [])
        .filter((task) => ['success', 'failed', 'cancelled', 'timeout'].includes(task.status))
        .map(n.runFromTask)
        .filter((item) => runFilter(bundle, item));
    },
    sample: {
      id: 77120,
      event_id: 'evt_7a2d4e6f8b0c1d3e5f7a9b1c3d5e7f90',
      workflow_id: 318,
      workflow_name: 'Hacker News front page',
      status: 'success',
      success: true,
      error: null,
      duration_ms: 8420,
      completed_at: '2026-11-19T14:03:00Z',
      extracted_data: [{ title: 'Show HN: Writ', points: 128 }],
      extracted_data_json: '[{"title":"Show HN: Writ","points":128}]',
      data_truncated: false,
    },
    outputFields: runOutput,
  }),
};

const crawlOutput = [
  { key: 'id', label: 'Crawl ID', type: 'integer' },
  { key: 'name', label: 'Name' },
  { key: 'seed_url', label: 'Starting URL' },
  { key: 'status', label: 'Status' },
  { key: 'pages_done', label: 'Pages Read', type: 'integer' },
  { key: 'pages_failed', label: 'Pages Failed', type: 'integer' },
  { key: 'pages_discovered', label: 'Pages Found', type: 'integer' },
  { key: 'error', label: 'Error' },
  { key: 'data_workflow_id', label: 'Data Workflow ID', type: 'integer' },
];

const crawlEvents = (bundle) => {
  const which = bundle.inputData.outcome || 'completed';
  return which === 'both' ? ['crawl_completed', 'crawl_failed'] : [which === 'failed' ? 'crawl_failed' : 'crawl_completed'];
};

const crawlFinished = {
  key: 'crawl_finished',
  noun: 'Crawl',
  display: { label: 'Crawl Finished', description: 'Triggers when a Writ crawl finishes, or fails.' },
  operation: hookOperation({
    label: 'crawl finished',
    events: crawlEvents,
    fromHook: n.crawlFromHook,
    inputFields: [
      {
        key: 'outcome',
        label: 'Outcome',
        choices: { completed: 'Finished', failed: 'Failed', both: 'Finished or failed' },
        default: 'completed',
        required: true,
      },
    ],
    list: async (z, bundle) => {
      const response = await z.request({ url: url('/api/crawl'), params: { limit: 25 } });
      const body = response.data;
      const jobs = Array.isArray(body) ? body : (body && (body.crawls || body.items)) || [];
      const wanted = crawlEvents(bundle).map((event) => (event === 'crawl_failed' ? 'failed' : 'completed'));
      return jobs.filter((job) => wanted.includes(job.status)).map((job) => n.crawlFromJob(job));
    },
    sample: {
      id: 5521,
      event_id: 'evt_0b9a8c7d6e5f4a3b2c1d0e9f8a7b6c5d',
      name: 'docs.example.com',
      seed_url: 'https://docs.example.com/',
      status: 'completed',
      pages_done: 214,
      pages_failed: 3,
      pages_discovered: 230,
      error: null,
      data_workflow_id: 901,
    },
    outputFields: crawlOutput,
  }),
};

const healthEvents = (bundle) => {
  const chosen = [].concat(bundle.inputData.events || []).filter(Boolean);
  return chosen.length ? chosen : ['monitor_down', 'monitor_recovered'];
};

const monitorHealth = {
  key: 'monitor_health',
  noun: 'Monitor Status',
  display: {
    label: 'Monitor Status Changed',
    description: 'Triggers when a Writ monitor goes down, stops reporting, or recovers.',
  },
  operation: hookOperation({
    label: 'monitor status changed',
    events: healthEvents,
    fromHook: n.healthFromHook,
    accept: sameMonitor,
    inputFields: [
      {
        key: 'events',
        label: 'Status Changes',
        list: true,
        required: false,
        choices: {
          monitor_down: 'Went down',
          monitor_stale: 'Stopped reporting',
          monitor_recovered: 'Recovered',
        },
        helpText: 'Leave empty for "went down" and "recovered".',
      },
      monitorPicker,
    ],
    // Writ keeps no history of status changes to list, so setup shows the documented sample.
    list: async (z, bundle) => [monitorHealth.operation.sample].filter((item) => sameMonitor(bundle, item) || !bundle.inputData.monitor_id),
    sample: {
      id: 'evt_2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
      event: 'monitor_down',
      monitor_id: 42,
      monitor_name: 'Example pricing',
      monitor_url: 'https://example.com/pricing',
      state: 'down',
      checked_at: '2026-11-19T14:03:00Z',
      status_code: 503,
      error: null,
    },
    outputFields: [
      { key: 'id', label: 'Event ID' },
      { key: 'event', label: 'Event' },
      { key: 'monitor_id', label: 'Monitor ID', type: 'integer' },
      { key: 'monitor_name', label: 'Monitor Name' },
      { key: 'monitor_url', label: 'Monitor URL' },
      { key: 'state', label: 'State' },
      { key: 'checked_at', label: 'Checked At', type: 'datetime' },
      { key: 'status_code', label: 'HTTP Status', type: 'integer' },
      { key: 'error', label: 'Error' },
    ],
  }),
};

module.exports = { newChange, runFinished, crawlFinished, monitorHealth };
