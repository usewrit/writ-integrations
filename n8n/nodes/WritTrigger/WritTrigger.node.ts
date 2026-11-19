import {
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

import { authenticationProperty, credentialsDescription } from '../Writ/shared/auth';
import { newWebhookSecret, verifyWritSignature } from '../Writ/shared/signature';
import { writRequest } from '../Writ/shared/transport';

/**
 * Writ Trigger: Writ pushes the chosen events to this workflow.
 *
 * On activation the node subscribes this workflow's webhook URL in Writ
 * (POST /api/webhooks/recipients) with a fresh random secret kept in the node's
 * static data; on deactivation it removes the subscription. Every delivery must
 * carry a valid X-Writ-Signature-V1 over the raw body, made with that secret, and
 * a timestamp under ten minutes old, or it is refused with 401 and nothing runs.
 *
 * Writ also removes the subscription by itself once the API key or the OAuth
 * connection that created it is revoked.
 */

interface SubscriptionState {
	recipientId?: number;
	secret?: string;
	url?: string;
}

const FALLBACK_EVENTS: INodePropertyOptions[] = [
	{ name: 'Monitor Detected a Change', value: 'change_detected' },
	{ name: 'Workflow Run Finished', value: 'workflow_completed' },
	{ name: 'Crawl Finished', value: 'crawl_completed' },
	{ name: 'Crawl Failed', value: 'crawl_failed' },
	{ name: 'Monitor Went Down', value: 'monitor_down' },
	{ name: 'Monitor Stopped Reporting', value: 'monitor_stale' },
	{ name: 'Monitor Recovered', value: 'monitor_recovered' },
	{ name: 'Automation Sent a Notification', value: 'notification' },
];

function titleCase(label: string): string {
	return label.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export class WritTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Writ Trigger',
		name: 'writTrigger',
		icon: { light: 'file:../../icons/writ.svg', dark: 'file:../../icons/writ.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when Writ sends an event: a page changed, a run or crawl finished, a monitor went down',
		defaults: { name: 'Writ Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: credentialsDescription,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			authenticationProperty,
			{
				displayName: 'Event Names or IDs',
				name: 'events',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getEvents' },
				required: true,
				default: ['change_detected'],
				description:
					'The Writ events that start this workflow. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Include Full Content',
				name: 'includeContent',
				type: 'boolean',
				default: false,
				description:
					'Whether a change event carries the whole content before and after, not only the first 1,000 characters',
				displayOptions: { show: { events: ['change_detected'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const answer = await writRequest<IDataObject>(this, {
						method: 'GET',
						path: '/api/webhooks/event-types',
					});
					const events = Array.isArray(answer.event_types) ? (answer.event_types as IDataObject[]) : [];
					if (!events.length) return FALLBACK_EVENTS;
					return events.map((event) => ({
						name: titleCase(String(event.label ?? event.name)),
						value: String(event.name),
						description: typeof event.description === 'string' ? event.description : undefined,
					}));
				} catch {
					return FALLBACK_EVENTS;
				}
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as SubscriptionState;
				if (!state.recipientId) return false;
				const row = await writRequest<IDataObject | undefined>(this, {
					method: 'GET',
					path: `/api/webhooks/recipients/${state.recipientId}`,
					allowNotFound: true,
				});
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!row || row.url !== webhookUrl || row.enabled === false) {
					delete state.recipientId;
					delete state.secret;
					delete state.url;
					return false;
				}
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as SubscriptionState;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				const includeContent = this.getNodeParameter('includeContent', false) as boolean;
				const secret = newWebhookSecret();
				const workflow = this.getWorkflow();
				const answer = await writRequest<IDataObject>(this, {
					method: 'POST',
					path: '/api/webhooks/recipients',
					body: {
						name: `n8n: ${workflow.name ?? 'workflow'} (${this.getNode().name})`.slice(0, 255),
						url: webhookUrl,
						method: 'POST',
						secret,
						event_types: events,
						include_content: includeContent,
						integration: 'n8n',
						external_ref: String(workflow.id ?? ''),
					},
				});
				const recipient = (answer.recipient ?? answer) as IDataObject;
				if (typeof recipient.id !== 'number') return false;
				state.recipientId = recipient.id;
				state.secret = secret;
				state.url = webhookUrl;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as SubscriptionState;
				if (state.recipientId) {
					await writRequest(this, {
						method: 'DELETE',
						path: `/api/webhooks/recipients/${state.recipientId}`,
						allowNotFound: true,
					});
				}
				delete state.recipientId;
				delete state.secret;
				delete state.url;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const state = this.getWorkflowStaticData('node') as SubscriptionState;
		const verdict = verifyWritSignature(
			state.secret ?? '',
			request.headers as Record<string, unknown>,
			(request as unknown as { rawBody?: Buffer }).rawBody,
		);
		if (!verdict.ok) {
			const response = this.getResponseObject();
			response.status(401).json({ error: 'invalid_signature', reason: verdict.reason });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events', []) as string[];
		if (typeof body.event !== 'string' || !events.includes(body.event)) {
			// Signed by Writ but not an event this node listens for: acknowledge, run nothing.
			return { webhookResponse: { received: true, ignored: true } };
		}
		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
