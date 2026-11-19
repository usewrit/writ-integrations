'use strict';

/**
 * One output shape per trigger, whether the item came from a webhook delivery or
 * from the API (performList, which Zapier uses for samples and while setting up a
 * Zap). `id` is the stable id Zapier keys on.
 */

const MAX_TEXT = 100000;
const clip = (value) => (typeof value === 'string' && value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value ?? null);

function changeFromHook(payload) {
  const target = payload.target || {};
  const change = payload.change || {};
  return {
    id: change.id ?? payload.event_id,
    event_id: payload.event_id ?? null,
    monitor_id: target.id ?? null,
    monitor_name: target.name ?? null,
    monitor_url: target.url ?? null,
    detected_at: change.detected_at ?? payload.timestamp ?? null,
    content_before: clip(change.full_content_before ?? change.content_before),
    content_after: clip(change.full_content_after ?? change.content_after),
    content_truncated: change.full_content_after !== undefined ? false : Boolean(change.content_truncated),
    diff: clip(change.diff ?? null),
  };
}

function changeFromFeed(row) {
  return {
    id: row.id,
    event_id: null,
    monitor_id: row.target_id ?? null,
    monitor_name: row.target_name ?? row.selector_name ?? null,
    monitor_url: row.target_url ?? null,
    detected_at: row.last_detected_at ?? null,
    content_before: null,
    content_after: null,
    content_truncated: false,
    diff: clip(row.diff_snippet ?? null),
  };
}

function runFromHook(payload) {
  const data = payload.data || {};
  const workflow = data.workflow || {};
  const run = data.run || {};
  return {
    id: run.id ?? payload.event_id,
    event_id: payload.event_id ?? null,
    workflow_id: workflow.id ?? null,
    workflow_name: workflow.name ?? null,
    status: run.status ?? null,
    success: Boolean(run.success),
    error: run.error ?? null,
    duration_ms: run.duration_ms ?? null,
    completed_at: run.completed_at ?? payload.timestamp ?? null,
    extracted_data: data.extracted_data ?? null,
    extracted_data_json: data.extracted_data == null ? null : JSON.stringify(data.extracted_data),
    data_truncated: Boolean(data.data_truncated),
  };
}

function runFromTask(task) {
  const result = task.result_data || {};
  return {
    id: task.id,
    event_id: null,
    workflow_id: task.workflow_id ?? null,
    workflow_name: task.workflow_name ?? null,
    status: task.status ?? null,
    success: task.success ?? task.status === 'success',
    error: task.error_message ?? null,
    duration_ms: task.duration_ms ?? null,
    completed_at: task.completed_at ?? null,
    extracted_data: result.extracted_data ?? null,
    extracted_data_json: result.extracted_data == null ? null : JSON.stringify(result.extracted_data),
    data_truncated: false,
  };
}

function crawlFromJob(job, eventId = null) {
  return {
    id: job.id,
    event_id: eventId,
    name: job.name ?? null,
    seed_url: job.seed_url ?? null,
    status: job.status ?? null,
    pages_done: job.pages_done ?? 0,
    pages_failed: job.pages_failed ?? 0,
    pages_discovered: job.pages_discovered ?? 0,
    error: job.error || null,
    data_workflow_id: job.data_workflow_id ?? job.workflow_id ?? null,
  };
}

function crawlFromHook(payload) {
  return crawlFromJob((payload.data && payload.data.crawl) || {}, payload.event_id ?? null);
}

function healthFromHook(payload) {
  const data = payload.data || {};
  const monitor = data.monitor || {};
  return {
    id: payload.event_id,
    event: payload.event,
    monitor_id: monitor.id ?? null,
    monitor_name: monitor.name ?? null,
    monitor_url: monitor.url ?? null,
    state: data.state ?? null,
    checked_at: data.checked_at ?? null,
    status_code: data.status_code ?? null,
    error: data.error ?? null,
  };
}

module.exports = {
  changeFromHook,
  changeFromFeed,
  runFromHook,
  runFromTask,
  crawlFromJob,
  crawlFromHook,
  healthFromHook,
};
