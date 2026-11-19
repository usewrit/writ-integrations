import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { authenticationProperty, credentialsDescription } from '../Writ/shared/auth';
import { writRequest } from '../Writ/shared/transport';

/**
 * Writ Changes Trigger: polls the account's change feed. For an n8n instance Writ
 * cannot reach over the internet; otherwise prefer Writ Trigger, which is pushed
 * and costs no API calls while nothing happens.
 *
 * The feed (GET /api/targets/changes/recent) takes a keyset cursor: `since` (the
 * last_detected_at of the newest change seen) and `since_id` (its id), compared as
 * a pair so changes with equal timestamps are never skipped, and answered oldest
 * first. The first poll only records where the feed is; it emits nothing, so
 * activating the workflow does not replay the account's history.
 *
 * A change that is detected again moves to the end of the feed under the same id,
 * so it is emitted again: that is a new detection, not a duplicate.
 */

interface Cursor {
	since?: string;
	sinceId?: number;
}

const PAGE = 200;

export class WritChangesTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Writ Changes Trigger',
		name: 'writChangesTrigger',
		icon: { light: 'file:../../icons/writ.svg', dark: 'file:../../icons/writ.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when a Writ monitor detects a change, by checking on a schedule',
		subtitle: 'Monitor changes',
		defaults: { name: 'Writ Changes Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: credentialsDescription,
		properties: [
			authenticationProperty,
			{
				displayName: 'Monitor ID',
				name: 'monitorId',
				type: 'number',
				default: 0,
				description: 'Only changes of this monitor. 0 means every monitor in the account.',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const cursor = this.getWorkflowStaticData('node') as Cursor;
		const monitorId = this.getNodeParameter('monitorId', 0) as number;
		const manual = this.getMode() === 'manual';

		if (!cursor.since && !manual) {
			// First poll: remember the newest change and emit nothing.
			const newest = await writRequest<IDataObject[]>(this, {
				method: 'GET',
				path: '/api/targets/changes/recent',
				qs: { limit: 1 },
			});
			const head = Array.isArray(newest) ? newest[0] : undefined;
			cursor.since = head ? String(head.last_detected_at) : new Date().toISOString();
			cursor.sinceId = head ? Number(head.id) : 0;
			return null;
		}

		const qs: IDataObject = { limit: manual ? 5 : PAGE };
		if (!manual && cursor.since) {
			qs.since = cursor.since;
			qs.since_id = cursor.sinceId ?? 0;
		}
		const rows = await writRequest<IDataObject[]>(this, {
			method: 'GET',
			path: '/api/targets/changes/recent',
			qs,
		});
		let changes = Array.isArray(rows) ? rows : [];
		if (!manual && changes.length) {
			// With a cursor the feed is oldest first: the last row is the newest seen.
			const last = changes[changes.length - 1];
			cursor.since = String(last.last_detected_at);
			cursor.sinceId = Number(last.id);
		}
		if (monitorId) changes = changes.filter((change) => Number(change.target_id) === monitorId);
		if (!changes.length) return null;
		return [this.helpers.returnJsonArray(changes)];
	}
}
