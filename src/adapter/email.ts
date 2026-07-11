import type { ChannelAdapter, AdapterContext, TransportRequest } from './types.js';
import type { InternalPushMessage } from '../push/types.js';

/**
 * Minimal Email Adapter - Phase 0: render only, no I/O, CPU <10ms, idempotent
 * Per DESIGN-DOC §4.9 MAX_EMAIL_ITEMS=10
 */
export const emailAdapter: ChannelAdapter = {
  id: 'email-mailchannels',
  config: {
    immediateRetries: 1,
    circuitThreshold: 5,
    circuitOpenSec: 60
  },
  async render(msg: InternalPushMessage, ctx: AdapterContext): Promise<TransportRequest> {
    // Pure render: no fetch, no EMAIL.send
    const to = ctx.secrets['EMAIL_TO'] ?? 'test@example.com';
    const from = ctx.secrets['EMAIL_FROM'] ?? 'gateway@example.com';

    // Simple MIME rendering (heavy part may move to DO in Phase 2 per v2.1 finding)
    const subject = `[${msg.severity.toUpperCase()}] ${msg.items[0]?.title ?? 'Notification'} x${msg.items.length}`;
    const bodyText = msg.items.map((it) => `- ${it.title}: ${JSON.stringify(it.body)}`).join('\n');

    // Keep CPU low: no complex templating yet
    const raw_mime = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      bodyText
    ].join('\r\n');

    return {
      transport: 'email',
      request: { from, to, raw_mime }
    };
  }
};

export const ADAPTER_REGISTRY = {
  'email-mailchannels': emailAdapter
} as const;
