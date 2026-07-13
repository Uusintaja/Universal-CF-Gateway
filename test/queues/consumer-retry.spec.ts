import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleQueueBatch } from '../../src/queues/consumer.js';

function fakeEvent(id: string, severity: any = 'low'): any {
  return {
    schema_version: '1.0',
    event_id: id,
    source_id: 'monitor',
    event_type: 'test',
    severity,
    timestamp: new Date().toISOString(),
    title: `Event ${id}`,
    body: {},
    trace: { gateway_trace: 'gt' },
    auth_context: null,
    metadata: {}
  };
}

function mockMessage(event: any, attempts = 1, adapterId = 'email-mailchannels') {
  return {
    body: { event, route: { adapter_ids: [adapterId], dispatch: 'enqueue', strategy: 'all' } },
    ack: vi.fn(),
    retry: vi.fn(),
    attempts
  } as any;
}

describe('Queue Consumer Phase 3B - Retry + Cold Path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lane_full -> retry with delay 10s, no ack', async () => {
    const env = {
      COORDINATOR: {
        idFromName: () => 'test',
        get: () => ({
          acquire: async () => ({ allowed: false, reason: 'lane_full' }),
          release: async () => {}
        })
      }
    } as any;

    const msg = mockMessage(fakeEvent('e1'));
    const batch = { queue: 'email-experimental', messages: [msg] } as any;

    await handleQueueBatch(batch, env, {} as any);

    expect(msg.retry).toHaveBeenCalled();
    const retryArg = msg.retry.mock.calls[0][0];
    expect(retryArg.delaySeconds).toBe(10);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('circuit_open -> retry with delay 60s', async () => {
    const env = {
      COORDINATOR: {
        idFromName: () => 'test',
        get: () => ({
          acquire: async () => ({ allowed: false, reason: 'circuit_open' }),
          release: async () => {}
        })
      }
    } as any;

    const msg = mockMessage(fakeEvent('e2'));
    const batch = { queue: 'email-experimental', messages: [msg] } as any;

    await handleQueueBatch(batch, env, {} as any);

    expect(msg.retry).toHaveBeenCalled();
    expect(msg.retry.mock.calls[0][0].delaySeconds).toBe(60);
  });

  it('transmit retryable 5xx with attempts < max -> retry with backoff', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const env = {
      COORDINATOR: {
        idFromName: () => 'test',
        get: () => ({
          acquire: async () => ({ allowed: true, lane: 'low_exclusive', to_send_ids: ['e3'] }),
          release: async () => {},
          archiveColdPath: async () => {}
        })
      }
    } as any;

    const msg = mockMessage(fakeEvent('e3'), 1, 'slack-webhook');
    const batch = { queue: 'slack-webhook-experimental', messages: [msg] } as any;

    await handleQueueBatch(batch, env, { waitUntil: (p: any) => p } as any);

    expect(msg.retry).toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('transmit non-retryable 4xx -> ack + archive drop', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const archiveMock = vi.fn().mockResolvedValue(undefined);
    const env = {
      COORDINATOR: {
        idFromName: () => 'test',
        get: () => ({
          acquire: async () => ({ allowed: true, lane: 'low_exclusive', to_send_ids: ['e4'] }),
          release: async () => {},
          archiveColdPath: archiveMock
        })
      },
      KV: {
        put: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const msg = mockMessage(fakeEvent('e4'), 1, 'slack-webhook');
    const batch = { queue: 'slack-webhook-experimental', messages: [msg] } as any;

    const waitUntilCalls: any[] = [];
    const ctx = {
      waitUntil: (p: any) => {
        waitUntilCalls.push(p);
        return p;
      }
    } as any;

    await handleQueueBatch(batch, env, ctx);

    expect(msg.ack).toHaveBeenCalled();
    expect(waitUntilCalls.length).toBeGreaterThan(0);
    // archive should have been called via waitUntil
    await Promise.all(waitUntilCalls);
    expect(archiveMock).toHaveBeenCalled();
  });

  it('attempts exhausted -> dlq', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const archiveMock = vi.fn().mockResolvedValue(undefined);
    const env = {
      COORDINATOR: {
        idFromName: () => 'test',
        get: () => ({
          acquire: async () => ({ allowed: true, lane: 'low_exclusive', to_send_ids: ['e5'] }),
          release: async () => {},
          archiveColdPath: archiveMock
        })
      }
    } as any;

    const msg = mockMessage(fakeEvent('e5'), 3, 'slack-webhook'); // attempts = maxRetries
    const batch = { queue: 'slack-webhook-experimental', messages: [msg] } as any;

    const ctx = { waitUntil: (p: any) => p } as any;
    await handleQueueBatch(batch, env, ctx);

    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });
});
