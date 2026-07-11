import { describe, it, expect } from 'vitest';
import { emailAdapter } from '../../src/adapter/email.js';
import type { InternalPushMessage } from '../../src/push/types.js';

function fakePush(severity: any = 'low'): InternalPushMessage {
  return {
    schema_version: '1.0',
    message_id: 'mid',
    target_adapter: 'email-mailchannels',
    severity,
    items: [
      { event_id: 'eid', title: 'Hello', body: { foo: 'bar' }, severity, timestamp: new Date().toISOString(), trace: { gateway_trace: 'gt' } }
    ],
    chunk: { index: 0, total: 1 },
    attempt: 0,
    created_at: new Date().toISOString()
  };
}

describe('Adapter email-mailchannels - render contract §4.1', () => {
  it('render is pure, no I/O, returns TransportRequest email', async () => {
    const msg = fakePush('high');
    const tr = await emailAdapter.render(msg, { secrets: {}, config: emailAdapter.config });
    expect(tr.transport).toBe('email');
    if (tr.transport === 'email') {
      expect(tr.request.raw_mime).toContain('Hello');
      expect(tr.request.raw_mime).toContain('HIGH');
    }
  });

  it('render is idempotent - same input same output', async () => {
    const msg = fakePush('info');
    const a = await emailAdapter.render(msg, { secrets: {}, config: emailAdapter.config });
    const b = await emailAdapter.render(msg, { secrets: {}, config: emailAdapter.config });
    expect(a).toEqual(b);
  });

  it('respects secrets for from/to', async () => {
    const msg = fakePush();
    const tr = await emailAdapter.render(msg, {
      secrets: { EMAIL_FROM: 'from@x.com', EMAIL_TO: 'to@y.com' },
      config: emailAdapter.config
    });
    if (tr.transport === 'email') {
      expect(tr.request.from).toBe('from@x.com');
      expect(tr.request.to).toBe('to@y.com');
    }
  });
});
