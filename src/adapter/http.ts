import type { ChannelAdapter, AdapterContext, TransportRequest } from './types.js';
import type { InternalPushMessage } from '../push/types.js';

/**
 * Generic HTTP Adapter (used for slack-webhook & webhook.site test target)
 * Phase 1: render only, transmit in output I/O Layer
 */

export const httpAdapter: ChannelAdapter = {
  id: 'slack-webhook',
  config: {
    immediateRetries: 1,
    circuitThreshold: 5,
    circuitOpenSec: 60
  },
  async render(msg: InternalPushMessage, ctx: AdapterContext): Promise<TransportRequest> {
    const url = ctx.secrets['SLACK_WEBHOOK_URL'] ?? ctx.secrets['WEBHOOK_SITE_URL'] ?? 'https://example.com/webhook';

    const body = JSON.stringify({
      text: `[${msg.severity.toUpperCase()}] ${msg.items[0]?.title} x${msg.items.length}`,
      items: msg.items.map((i) => ({ event_id: i.event_id, title: i.title, severity: i.severity })),
      trace: msg.items[0]?.trace,
      chunk: msg.chunk
    });

    return {
      transport: 'http',
      request: {
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body
      }
    };
  }
};

export const webhookSiteAdapter: ChannelAdapter = {
  id: 'webhook-site',
  config: {
    immediateRetries: 0,
    circuitThreshold: 5,
    circuitOpenSec: 30
  },
  async render(msg: InternalPushMessage, ctx: AdapterContext): Promise<TransportRequest> {
    const url = ctx.secrets['WEBHOOK_SITE_URL'] ?? 'https://webhook.site/test';
    return {
      transport: 'http',
      request: {
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', 'X-Gateway-Trace': msg.items[0]?.trace.gateway_trace ?? '' },
        body: JSON.stringify(msg)
      }
    };
  }
};
