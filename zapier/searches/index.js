'use strict';

const { url } = require('../lib/config');

const contains = (haystack, needle) => String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());

const findWorkflow = {
  key: 'find_workflow',
  noun: 'Workflow',
  display: { label: 'Find Workflow', description: 'Finds a saved Writ workflow by name.' },
  operation: {
    inputFields: [{ key: 'name', label: 'Name', required: true, helpText: 'All or part of the workflow name.' }],
    perform: async (z, bundle) => {
      const response = await z.request({ url: url('/api/automation/workflows') });
      return (Array.isArray(response.data) ? response.data : [])
        .filter((workflow) => workflow.workflow_type !== 'crawl' && contains(workflow.name, bundle.inputData.name))
        .map((workflow) => ({ id: workflow.id, name: workflow.name, description: workflow.description ?? null }));
    },
    sample: { id: 318, name: 'Hacker News front page', description: null },
    outputFields: [
      { key: 'id', label: 'Workflow ID', type: 'integer' },
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
    ],
  },
};

const findMonitor = {
  key: 'find_monitor',
  noun: 'Monitor',
  display: { label: 'Find Monitor', description: 'Finds a Writ monitor by its URL or name.' },
  operation: {
    inputFields: [{ key: 'query', label: 'URL or Name', required: true }],
    perform: async (z, bundle) => {
      const response = await z.request({ url: url('/api/targets') });
      return (Array.isArray(response.data) ? response.data : [])
        .filter((monitor) => contains(monitor.url, bundle.inputData.query) || contains(monitor.name, bundle.inputData.query))
        .map((monitor) => ({ id: monitor.id, name: monitor.name ?? null, url: monitor.url, enabled: monitor.enabled ?? true }));
    },
    sample: { id: 42, name: 'Example pricing', url: 'https://example.com/pricing', enabled: true },
    outputFields: [
      { key: 'id', label: 'Monitor ID', type: 'integer' },
      { key: 'name', label: 'Name' },
      { key: 'url', label: 'URL' },
      { key: 'enabled', label: 'Enabled', type: 'boolean' },
    ],
  },
};

const findRecords = {
  key: 'find_records',
  noun: 'Record',
  display: { label: 'Find Records', description: 'Finds rows a Writ workflow extracted, by text they contain.' },
  operation: {
    inputFields: [
      { key: 'workflow_id', label: 'Workflow', type: 'integer', dynamic: 'workflow_list.id.name', required: true },
      { key: 'query', label: 'Contains', required: true },
    ],
    perform: async (z, bundle) => {
      const response = await z.request({
        url: url(`/api/v1/workflows/${bundle.inputData.workflow_id}/data`),
        params: { q: bundle.inputData.query, limit: 25 },
      });
      const rows = (response.data && response.data.rows) || [];
      return rows.map((row, index) => ({ id: row.id ?? row.task_id ?? `${bundle.inputData.workflow_id}-${index}`, ...row }));
    },
    sample: { id: 'row-1', title: 'Show HN: Writ', points: 128 },
    outputFields: [{ key: 'id', label: 'Record ID' }],
  },
};

module.exports = { findWorkflow, findMonitor, findRecords };
