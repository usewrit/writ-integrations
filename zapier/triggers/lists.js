'use strict';

const { url } = require('../lib/config');

/** Hidden triggers that fill the workflow and monitor pickers. */
const workflowList = {
  key: 'workflow_list',
  noun: 'Workflow',
  display: { label: 'List Workflows', description: 'Fills the workflow picker.', hidden: true },
  operation: {
    perform: async (z) => {
      const response = await z.request({ url: url('/api/automation/workflows') });
      return (Array.isArray(response.data) ? response.data : [])
        .filter((workflow) => workflow.workflow_type !== 'crawl')
        .map((workflow) => ({ id: workflow.id, name: workflow.name || `Workflow ${workflow.id}` }));
    },
    sample: { id: 318, name: 'Hacker News front page' },
    outputFields: [
      { key: 'id', label: 'Workflow ID', type: 'integer' },
      { key: 'name', label: 'Name' },
    ],
  },
};

const monitorList = {
  key: 'monitor_list',
  noun: 'Monitor',
  display: { label: 'List Monitors', description: 'Fills the monitor picker.', hidden: true },
  operation: {
    perform: async (z) => {
      const response = await z.request({ url: url('/api/targets') });
      return (Array.isArray(response.data) ? response.data : []).map((monitor) => ({
        id: monitor.id,
        name: monitor.name || monitor.url || `Monitor ${monitor.id}`,
      }));
    },
    sample: { id: 42, name: 'https://example.com/pricing' },
    outputFields: [
      { key: 'id', label: 'Monitor ID', type: 'integer' },
      { key: 'name', label: 'Name' },
    ],
  },
};

module.exports = { workflowList, monitorList };
