'use strict';

const { url } = require('./config');
const { newWebhookSecret, verifyWritSignature } = require('./signature');

/**
 * A REST-hook trigger over Writ webhook subscriptions.
 *
 *  subscribe    POST /api/webhooks/recipients with Zapier's target URL, the events, a
 *               fresh secret, and the Zap id; Writ records the subscription as made by
 *               Zapier and removes it on its own if the connection is revoked.
 *  unsubscribe  DELETE /api/webhooks/recipients/{id} (already gone is fine).
 *  perform      verifies X-Writ-Signature-V1 over the raw body with the stored secret,
 *               then emits the normalised item. A delivery that fails verification
 *               throws, so forged data never reaches the Zap.
 *  performList  the same shape from the API, for samples and Zap setup.
 */
function hookOperation({ label, events, fromHook, accept, list, inputFields = [], sample, outputFields }) {
  return {
    type: 'hook',
    inputFields,
    performSubscribe: async (z, bundle) => {
      const secret = newWebhookSecret();
      const zapId = bundle.meta && bundle.meta.zap && bundle.meta.zap.id;
      const response = await z.request({
        url: url('/api/webhooks/recipients'),
        method: 'POST',
        body: {
          name: `Zapier: ${label}${zapId ? ` (Zap ${zapId})` : ''}`.slice(0, 255),
          url: bundle.targetUrl,
          method: 'POST',
          secret,
          event_types: events(bundle),
          include_content: true,
          integration: 'zapier',
          external_ref: zapId ? String(zapId) : null,
        },
      });
      const recipient = (response.data && (response.data.recipient || response.data)) || {};
      return { id: recipient.id, secret };
    },
    performUnsubscribe: async (z, bundle) => {
      const id = bundle.subscribeData && bundle.subscribeData.id;
      if (!id) return {};
      const response = await z.request({
        url: url(`/api/webhooks/recipients/${id}`),
        method: 'DELETE',
        skipThrowForStatus: true,
      });
      if (response.status >= 400 && response.status !== 404) {
        throw new z.errors.Error(`Writ refused to remove the subscription (${response.status}).`, 'writ_unsubscribe', response.status);
      }
      return {};
    },
    perform: async (z, bundle) => {
      const raw = bundle.rawRequest || {};
      const verdict = verifyWritSignature(bundle.subscribeData && bundle.subscribeData.secret, raw.headers, raw.content);
      if (!verdict.ok) {
        throw new z.errors.Error(`Refused a webhook delivery that Writ did not sign (${verdict.reason}).`, 'writ_signature', 401);
      }
      const payload = bundle.cleanedRequest || {};
      if (!events(bundle).includes(payload.event)) return [];
      const item = fromHook(payload);
      return accept && !accept(bundle, item) ? [] : [item];
    },
    performList: list,
    sample,
    outputFields,
  };
}

module.exports = { hookOperation };
