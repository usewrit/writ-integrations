import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { authenticationProperty, credentialsDescription } from './shared/auth';
import { pause, writRequest } from './shared/transport';

/** A run or crawl in one of these states will not change any more. */
const TERMINAL_RUN = new Set(['success', 'failed', 'cancelled', 'canceled', 'timeout', 'error']);
const TERMINAL_CRAWL = new Set(['completed', 'failed', 'cancelled', 'canceled']);

const POLL_FIRST_MS = 2_000;
const POLL_MAX_MS = 15_000;

function lines(value: unknown): string[] | undefined {
	if (typeof value !== 'string') return undefined;
	const out = value
		.split(/[\n,]/)
		.map((part) => part.trim())
		.filter(Boolean);
	return out.length ? out : undefined;
}

/** Poll `read` until `done` says so or `maxWaitSeconds` pass; returns the last answer. */
async function waitFor(
	read: () => Promise<IDataObject>,
	done: (value: IDataObject) => boolean,
	maxWaitSeconds: number,
): Promise<{ value: IDataObject; finished: boolean }> {
	const deadline = Date.now() + maxWaitSeconds * 1000;
	let delay = POLL_FIRST_MS;
	let value = await read();
	while (!done(value) && Date.now() + delay < deadline) {
		await pause(delay);
		delay = Math.min(delay * 1.5, POLL_MAX_MS);
		value = await read();
	}
	return { value, finished: done(value) };
}

export class Writ implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Writ',
		name: 'writ',
		icon: { light: 'file:../../icons/writ.svg', dark: 'file:../../icons/writ.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Scrape and map pages, crawl sites, run your Writ workflows and read their data, and manage monitors',
		defaults: { name: 'Writ' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: credentialsDescription,
		properties: [
			authenticationProperty,
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Crawl', value: 'crawl' },
					{ name: 'Monitor', value: 'monitor' },
					{ name: 'Page', value: 'page' },
					{ name: 'Workflow', value: 'workflow' },
				],
				default: 'page',
			},

			// ── Page ──────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['page'] } },
				options: [
					{
						name: 'Map Site',
						value: 'map',
						description: "List a site's pages, ranked by a search phrase when given one",
						action: 'Map a site',
					},
					{
						name: 'Scrape',
						value: 'scrape',
						description: 'Read one page as clean markdown or HTML',
						action: 'Scrape a page',
					},
				],
				default: 'scrape',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/pricing',
				displayOptions: { show: { resource: ['page', 'crawl'], operation: ['scrape', 'map', 'start'] } },
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'Markdown', value: 'markdown', description: "The page's main content as clean markdown" },
					{ name: 'HTML', value: 'html', description: 'The raw HTML as fetched' },
					{ name: 'Both', value: 'both' },
				],
				default: 'markdown',
				displayOptions: { show: { resource: ['page'], operation: ['scrape'] } },
			},
			{
				displayName: 'Options',
				name: 'scrapeOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['page'], operation: ['scrape'] } },
				options: [
					{
						displayName: 'Render Mode',
						name: 'renderMode',
						type: 'options',
						options: [
							{ name: 'Auto', value: 'auto', description: 'Plain fetch first, a browser when the page needs one' },
							{ name: 'Browser', value: 'browser', description: 'Always render in a browser (JavaScript pages)' },
							{ name: 'HTTP', value: 'http', description: 'Plain fetch only' },
						],
						default: 'auto',
					},
					{
						displayName: 'Persona ID',
						name: 'personaId',
						type: 'number',
						default: 0,
						description: 'Read the page signed in as this Writ persona (a saved sign-in)',
					},
					{
						displayName: 'Use Residential Network',
						name: 'useResidential',
						type: 'boolean',
						default: false,
						description: 'Whether to fetch through the residential network, for pages that refuse data-center addresses (uses more credits)',
					},
				],
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Rank the URLs by relevance to this phrase',
				displayOptions: { show: { resource: ['page'], operation: ['map'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 500 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['page'], operation: ['map'] } },
			},

			// ── Crawl ─────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['crawl'] } },
				options: [
					{ name: 'Get', value: 'get', description: "A crawl's status and counts", action: 'Get a crawl' },
					{
						name: 'Get Pages',
						value: 'getPages',
						description: 'The pages a crawl collected',
						action: 'Get the pages of a crawl',
					},
					{
						name: 'Start',
						value: 'start',
						description: 'Crawl a site from a starting URL',
						action: 'Start a crawl',
					},
				],
				default: 'start',
			},
			{
				displayName: 'Crawl ID',
				name: 'crawlId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['crawl'], operation: ['get', 'getPages'] } },
			},
			{
				displayName: 'Page Budget',
				name: 'pageBudget',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 50000 },
				default: 100,
				description: 'Most pages the crawl may read',
				displayOptions: { show: { resource: ['crawl'], operation: ['start'] } },
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				description:
					'Whether to wait for the crawl or run to finish. When it takes longer than the maximum wait, the node returns it as still running.',
				displayOptions: { show: { resource: ['crawl', 'workflow'], operation: ['start', 'run'] } },
			},
			{
				displayName: 'Max Wait (Seconds)',
				name: 'maxWaitSeconds',
				type: 'number',
				typeOptions: { minValue: 5, maxValue: 3600 },
				default: 300,
				displayOptions: {
					show: { resource: ['crawl', 'workflow'], operation: ['start', 'run'], waitForCompletion: [true] },
				},
			},
			{
				displayName: 'Options',
				name: 'crawlOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['crawl'], operation: ['start'] } },
				options: [
					{
						displayName: 'Exclude Paths',
						name: 'excludePaths',
						type: 'string',
						default: '',
						placeholder: '/blog/*',
						description: 'Paths to skip, one per line or separated by commas',
					},
					{
						displayName: 'Extract Mode',
						name: 'extractMode',
						type: 'options',
						options: [
							{ name: 'Markdown', value: 'markdown' },
							{ name: 'HTML', value: 'html' },
						],
						default: 'markdown',
					},
					{
						displayName: 'Goal',
						name: 'intent',
						type: 'string',
						default: '',
						placeholder: 'Every product page with its price',
						description: 'What the crawl is for, in plain words. Writ reads the most relevant pages first.',
					},
					{
						displayName: 'Include Paths',
						name: 'includePaths',
						type: 'string',
						default: '',
						placeholder: '/docs/*',
						description: 'Only crawl these paths, one per line or separated by commas',
					},
					{
						displayName: 'Max Depth',
						name: 'maxDepth',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 20 },
						default: 3,
						description: 'How many links away from the starting URL to go',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Render Mode',
						name: 'renderMode',
						type: 'options',
						options: [
							{ name: 'Auto', value: 'auto' },
							{ name: 'Browser', value: 'browser' },
							{ name: 'HTTP', value: 'http' },
						],
						default: 'auto',
					},
				],
			},
			{
				displayName: 'Limit',
				name: 'pagesLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 500 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['crawl'], operation: ['getPages'] } },
			},

			// ── Workflow ──────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['workflow'] } },
				options: [
					{
						name: 'Get Data',
						value: 'getData',
						description: 'Rows a workflow extracted over its runs',
						action: 'Get the data of a workflow',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'The workflows in your Writ account',
						action: 'Get many workflows',
					},
					{ name: 'Get Run', value: 'getRun', description: 'One run and its result', action: 'Get a workflow run' },
					{
						name: 'Run',
						value: 'run',
						description: 'Run a saved workflow (a website turned into an API) with inputs',
						action: 'Run a workflow',
					},
				],
				default: 'run',
			},
			{
				displayName: 'Workflow Name or ID',
				name: 'workflowId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getWorkflows' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['workflow'], operation: ['run', 'getRun', 'getData'] } },
			},
			{
				displayName: 'Inputs',
				name: 'inputs',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Input',
				default: {},
				description: "The workflow's input values, by input name",
				displayOptions: { show: { resource: ['workflow'], operation: ['run'] } },
				options: [
					{
						displayName: 'Input',
						name: 'input',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '', placeholder: 'query' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '', placeholder: 'laptops' },
						],
					},
				],
			},
			{
				displayName: 'Function Name',
				name: 'functionName',
				type: 'string',
				default: '',
				description: 'For a workflow with several functions, the one to call. Leave empty for the default.',
				displayOptions: { show: { resource: ['workflow'], operation: ['run'] } },
			},
			{
				displayName: 'Run ID',
				name: 'runId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['workflow'], operation: ['getRun'] } },
			},
			{
				displayName: 'Search',
				name: 'dataQuery',
				type: 'string',
				default: '',
				description: 'Only rows containing this text',
				displayOptions: { show: { resource: ['workflow'], operation: ['getData'] } },
			},
			{
				displayName: 'Limit',
				name: 'dataLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 500 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['workflow'], operation: ['getData'] } },
			},

			// ── Monitor ───────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['monitor'] } },
				options: [
					{
						name: 'Check Now',
						value: 'check',
						description: 'Queue a check of a monitor right away',
						action: 'Check a monitor now',
					},
					{ name: 'Create', value: 'create', description: 'Watch a page for changes', action: 'Create a monitor' },
					{ name: 'Get Changes', value: 'getChanges', description: 'Changes a monitor detected', action: 'Get the changes of a monitor' },
					{ name: 'Get Many', value: 'getAll', description: 'The monitors in your Writ account', action: 'Get many monitors' },
				],
				default: 'create',
			},
			{
				displayName: 'Monitor Name or ID',
				name: 'monitorId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMonitors' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: { show: { resource: ['monitor'], operation: ['check', 'getChanges'] } },
			},
			{
				displayName: 'URL',
				name: 'monitorUrl',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/pricing',
				displayOptions: { show: { resource: ['monitor'], operation: ['create'] } },
			},
			{
				displayName: 'Options',
				name: 'monitorOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['monitor'], operation: ['create'] } },
				options: [
					{
						displayName: 'Check Every (Minutes)',
						name: 'checkEveryMinutes',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 60,
					},
					{
						displayName: 'Check Type',
						name: 'checkType',
						type: 'options',
						options: [
							{ name: 'Content', value: 'content', description: 'Alert when the content changes' },
							{ name: 'Uptime', value: 'uptime', description: 'Alert when the page stops answering' },
						],
						default: 'content',
					},
					{
						displayName: 'CSS Selector',
						name: 'selector',
						type: 'string',
						default: '',
						placeholder: '.price',
						description: 'Watch only this part of the page',
					},
					{
						displayName: 'Ignore Pattern',
						name: 'ignoreRegex',
						type: 'string',
						default: '',
						description: 'Regular expression for text that should not count as a change (dates, counters)',
					},
					{
						displayName: 'Render with a Browser',
						name: 'requiresPlaywright',
						type: 'boolean',
						default: false,
						description: 'Whether the page needs JavaScript to show its content',
					},
				],
			},
			{
				displayName: 'Limit',
				name: 'changesLimit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 200 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['monitor'], operation: ['getChanges', 'getAll'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getWorkflows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const rows = await writRequest<IDataObject[]>(this, { method: 'GET', path: '/api/automation/workflows' });
				return (Array.isArray(rows) ? rows : [])
					.filter((row) => row.workflow_type !== 'crawl')
					.map((row) => ({ name: String(row.name ?? `Workflow ${row.id}`), value: Number(row.id) }));
			},
			async getMonitors(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const rows = await writRequest<IDataObject[]>(this, { method: 'GET', path: '/api/targets' });
				return (Array.isArray(rows) ? rows : []).map((row) => ({
					name: String(row.name || row.url || `Monitor ${row.id}`),
					value: Number(row.id),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const result = await runOperation(this, resource, operation, i);
				const rows = Array.isArray(result) ? result : [result];
				for (const row of rows) out.push({ json: row, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Both constructors hand back an error that is already theirs unchanged.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [out];
	}
}

async function runOperation(
	ctx: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const param = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, i, fallback);

	if (resource === 'page' && operation === 'scrape') {
		const options = param('scrapeOptions', {}) as IDataObject;
		const body: IDataObject = { url: param('url'), format: param('format', 'markdown') };
		if (options.renderMode) body.render_mode = options.renderMode;
		if (options.personaId) body.persona_id = options.personaId;
		if (options.useResidential) body.use_residential = true;
		return await writRequest<IDataObject>(ctx, { method: 'POST', path: '/api/crawl/scrape', body }, i);
	}

	if (resource === 'page' && operation === 'map') {
		const body: IDataObject = { url: param('url'), limit: param('limit', 50) };
		const search = param('search', '') as string;
		if (search) body.search = search;
		const answer = await writRequest<IDataObject>(ctx, { method: 'POST', path: '/api/crawl/map', body }, i);
		const urls = Array.isArray(answer.urls) ? (answer.urls as IDataObject[]) : [];
		return urls.length ? urls : [answer];
	}

	if (resource === 'crawl' && operation === 'start') {
		const options = param('crawlOptions', {}) as IDataObject;
		const body: IDataObject = { url: param('url'), page_budget: param('pageBudget', 100) };
		if (options.name) body.name = options.name;
		if (options.intent) body.intent = options.intent;
		if (options.extractMode) body.extract_mode = options.extractMode;
		if (options.renderMode) body.render_mode = options.renderMode;
		if (options.maxDepth !== undefined) body.max_depth = options.maxDepth;
		const include = lines(options.includePaths);
		const exclude = lines(options.excludePaths);
		if (include) body.include_paths = include;
		if (exclude) body.exclude_paths = exclude;
		const job = await writRequest<IDataObject>(ctx, { method: 'POST', path: '/api/crawl', body }, i);
		if (!param('waitForCompletion', true)) return job;
		const id = job.id ?? job.crawl_id;
		const { value, finished } = await waitFor(
			() => writRequest<IDataObject>(ctx, { method: 'GET', path: `/api/crawl/${id}` }, i),
			(crawl) => TERMINAL_CRAWL.has(String(crawl.status)),
			param('maxWaitSeconds', 300) as number,
		);
		return { ...value, finished };
	}

	if (resource === 'crawl' && operation === 'get') {
		return await writRequest<IDataObject>(ctx, { method: 'GET', path: `/api/crawl/${param('crawlId')}` }, i);
	}

	if (resource === 'crawl' && operation === 'getPages') {
		const crawl = await writRequest<IDataObject>(ctx, { method: 'GET', path: `/api/crawl/${param('crawlId')}` }, i);
		const dataWorkflowId = crawl.workflow_id ?? crawl.data_workflow_id;
		if (!dataWorkflowId) return [];
		const table = await writRequest<IDataObject>(
			ctx,
			{ method: 'GET', path: `/api/v1/workflows/${dataWorkflowId}/data`, qs: { limit: param('pagesLimit', 50) } },
			i,
		);
		return rowsOf(table);
	}

	if (resource === 'workflow' && operation === 'getAll') {
		const rows = await writRequest<IDataObject[]>(ctx, { method: 'GET', path: '/api/automation/workflows' }, i);
		return (Array.isArray(rows) ? rows : []).filter((row) => row.workflow_type !== 'crawl');
	}

	if (resource === 'workflow' && operation === 'run') {
		const workflowId = param('workflowId');
		const pairs = ((param('inputs', {}) as IDataObject).input ?? []) as Array<{ name?: string; value?: unknown }>;
		const formData: IDataObject = {};
		for (const pair of pairs) {
			const name = (pair.name ?? '').trim();
			if (name) formData[name] = pair.value ?? '';
		}
		const body: IDataObject = { form_data: formData };
		const functionName = param('functionName', '') as string;
		if (functionName) body.function_name = functionName;
		const started = await writRequest<IDataObject>(
			ctx,
			{ method: 'POST', path: `/api/automation/workflows/${workflowId}/run`, body },
			i,
		);
		if (!param('waitForCompletion', true) || !started.task_id) return started;
		const { value, finished } = await waitFor(
			() => writRequest<IDataObject>(ctx, { method: 'GET', path: `/api/automation/tasks/${started.task_id}` }, i),
			(task) => TERMINAL_RUN.has(String(task.status)),
			param('maxWaitSeconds', 300) as number,
		);
		return runResult(value, finished);
	}

	if (resource === 'workflow' && operation === 'getRun') {
		const task = await writRequest<IDataObject>(
			ctx,
			{ method: 'GET', path: `/api/automation/tasks/${param('runId')}` },
			i,
		);
		return runResult(task, TERMINAL_RUN.has(String(task.status)));
	}

	if (resource === 'workflow' && operation === 'getData') {
		const qs: IDataObject = { limit: param('dataLimit', 50) };
		const q = param('dataQuery', '') as string;
		if (q) qs.q = q;
		const table = await writRequest<IDataObject>(
			ctx,
			{ method: 'GET', path: `/api/v1/workflows/${param('workflowId')}/data`, qs },
			i,
		);
		return rowsOf(table);
	}

	if (resource === 'monitor' && operation === 'create') {
		const options = param('monitorOptions', {}) as IDataObject;
		const body: IDataObject = { url: param('monitorUrl'), check_type: options.checkType || 'content' };
		if (options.selector) body.selector = options.selector;
		if (options.ignoreRegex) body.ignore_regex = options.ignoreRegex;
		if (options.requiresPlaywright) body.requires_playwright = true;
		if (options.checkEveryMinutes) body.check_period_ms = Number(options.checkEveryMinutes) * 60_000;
		return await writRequest<IDataObject>(ctx, { method: 'POST', path: '/api/targets', body }, i);
	}

	if (resource === 'monitor' && operation === 'check') {
		return await writRequest<IDataObject>(ctx, { method: 'POST', path: `/api/targets/${param('monitorId')}/run` }, i);
	}

	if (resource === 'monitor' && operation === 'getAll') {
		const rows = await writRequest<IDataObject[]>(ctx, { method: 'GET', path: '/api/targets' }, i);
		return (Array.isArray(rows) ? rows : []).slice(0, param('changesLimit', 50) as number);
	}

	if (resource === 'monitor' && operation === 'getChanges') {
		const rows = await writRequest<IDataObject[]>(
			ctx,
			{ method: 'GET', path: `/api/targets/${param('monitorId')}/changes`, qs: { limit: param('changesLimit', 50) } },
			i,
		);
		return Array.isArray(rows) ? rows : [];
	}

	throw new NodeOperationError(ctx.getNode(), `The operation "${operation}" is not known for "${resource}"`, {
		itemIndex: i,
	});
}

function rowsOf(table: IDataObject): IDataObject[] {
	for (const key of ['rows', 'records', 'data', 'items']) {
		const value = table[key];
		if (Array.isArray(value)) return value as IDataObject[];
	}
	return [table];
}

function runResult(task: IDataObject, finished: boolean): IDataObject {
	const result = (task.result_data ?? {}) as IDataObject;
	return {
		run_id: task.id ?? task.task_id,
		workflow_id: task.workflow_id,
		status: task.status,
		success: task.success ?? (task.status === 'success'),
		finished,
		error: task.error_message ?? null,
		extracted_data: result.extracted_data ?? null,
		started_at: task.started_at ?? null,
		completed_at: task.completed_at ?? null,
		result_data: task.result_data ?? null,
	};
}
