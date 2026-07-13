import { describe, it, expect, vi } from 'vitest';
import { handleQueueBatch } from '../../src/queues/consumer.js';
import type { QueuePayload } from '../../src/queues/types.js';

function fakeEvent(id: string): any {
  return {
    schema_version: '1.0',
    event_id: id,
    source_id: 'monitor',
    event_type: 'test',
    severity: 'low',
    timestamp: new Date().toISOString(),
    title: `Event ${id}`,
    body: {},
    trace: { gateway_trace: 'gt' },
    auth_context: null,
    metadata: {}
  };
}

function mockEnv() {
  const coordinatorCalls: any[] = [];
  return {
    COORDINATOR: {
      idFromName: (s: string) => s,
      get: (name: string) => ({
        acquire: async ({ event_ids }: any) => {
          coordinatorCalls.push({ op: 'acquire', ids: event_ids });
          return { allowed: true, lane: 'low_exclusive', to_send_ids: event_ids };
        },
        release: async (p: any) => {
          coordinatorCalls.push({ op: 'release', ...p });
        }
      })
    },
    EMAIL_FROM: 'a@b.com',
    EMAIL_TO: 'c@d.com',
    _calls: coordinatorCalls
  } as any;
}

function mockMessage(event: any) {
  return {
    body: { event, route: { adapter_ids: ['email-mailchannels'], dispatch: 'enqueue', strategy: 'all' } } as QueuePayload,
    ack: vi.fn(),
    retry: vi.fn(),
    attempts: 1
  } as any;
}

describe('Queue Consumer Happy Path - Phase 3A', () => {
  it('should ack after successful render+transmit via DO', async () => {
    const env = mockEnv();
    const msg1 = mockMessage(fakeEvent('eid1'));
    const msg2 = mockMessage(fakeEvent('eid2'));

    // Mock fetch for transmit
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const batch = {
      queue: 'email-experimental',
      messages: [msg1, msg2]
    } as any;

    await handleQueueBatch(batch, env, {} as any);

    // Both messages should be acked (happy path)
    expect(msg1.ack).toHaveBeenCalled();
    expect(msg2.ack).toHaveBeenCalled();
    // Coordinator acquire/release called
    expect(env._calls.some((c: any) => c.op === 'acquire')).toBe(true);
    expect(env._calls.some((c: any) => c.op === 'release')).toBe(true);
  });

  it('should handle already_delivered -> to_send empty -> ack skip', async () => {
    const env = {
      COORDINATOR: {
        idFromName: () => 'test',
        get: () => ({
          acquire: async () => ({ allowed: true, lane: 'low_exclusive', to_send_ids: [] }),
          release: async () => {}
        })
      }
    } as any;

    const msg = mockMessage(fakeEvent('dup'));
    const batch = { queue: 'email-experimental', messages: [msg] } as any;

    await handleQueueBatch(batch, env, {} as any);
    expect(msg.ack).toHaveBeenCalled();
  });
});
