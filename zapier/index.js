'use strict';

const { version: platformVersion } = require('zapier-platform-core');
const { version } = require('./package.json');

const authentication = require('./authentication');
const { addHeaders, handleErrors } = require('./lib/request');
const { workflowList, monitorList } = require('./triggers/lists');
const { newChange, runFinished, crawlFinished, monitorHealth } = require('./triggers/events');
const creates = require('./creates');
const searches = require('./searches');

const byKey = (items) => Object.fromEntries(items.map((item) => [item.key, item]));

module.exports = {
  version,
  platformVersion,
  authentication,
  // Inputs reach perform exactly as the user mapped them (no implicit type cleaning).
  flags: { cleanInputData: false },
  beforeRequest: [addHeaders],
  afterResponse: [handleErrors],
  triggers: byKey([newChange, runFinished, crawlFinished, monitorHealth, workflowList, monitorList]),
  creates: byKey(Object.values(creates)),
  searches: byKey(Object.values(searches)),
};
