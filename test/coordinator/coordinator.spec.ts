import { describe, it, expect, beforeEach } from 'vitest';
import { CoordinatorDO } from '../../src/coordinator/coordinator.js';

// Reuse mock storage from storage.spec but need to inject into DO
// Simplified: create DO with mocked state.storage

function createMockState() {
  const map = new Map<string, any>();
  const storage = {
    async get(k: any) {
      if (Array.isArray(k)) {
        const m = new Map();
        for (const key of k) if (map.has(key)) m.set(key, map.get(key));
        return m;
      }
      return map.get(k);
    },
    async put(k: any, v?: any) {
      if (typeof k === 'object' && v === undefined) {
        for (const [key, val] of Object.entries(k)) map.set(key, val);
      } else {
        map.set(k, v);
      }
    },
    async delete(k: any) {
      if (Array.isArray(k)) k.forEach((key) => map.delete(key));
      else map.delete(k);
    },
    async list(opts: any = {}) {
      const prefix = opts.prefix ?? '';
      const limit = opts.limit ?? 1000;
      const res = new Map();
      let c = 0;
      for (const [key, val] of map) {
        if (key.startsWith(prefix)) {
          res.set(key, val);
          if (++c >= limit) break;
        }
      }
      return res;
    }
  } as any;

  return { storage, id: { toString: () => 'test-id' } } as any;
}

describe('CoordinatorDO - invariants P0/P1', () => {
  let doInstance: any;
  let state: any;

  beforeEach(() => {
    state = createMockState();
    doInstance = new CoordinatorDO(state);
  });

  it('acquire only read, not write delivered - P0 invariant', async () => {
    // First acquire should return to_send = all, not write delivered
    const res1 = await doInstance.acquire({ event_ids: ['eid1'], severity: 'high', adapter_id: 'test' });
    expect(res1.allowed).toBe(true);
    expect(res1.to_send_ids).toContain('eid1');

    // Check delivered not yet written
    const { delivered } = await doInstance.checkDelivered(['eid1']);
    expect(delivered).toHaveLength(0);

    // Release success true -> should write
    await doInstance.release({ event_ids: ['eid1'], lane: res1.lane, success: true, adapter_id: 'test' });
    const after = await doInstance.checkDelivered(['eid1']);
    expect(after.delivered).toContain('eid1');
  });

  it('release(false) should NOT write delivered - P0', async () => {
    const res = await doInstance.acquire({ event_ids: ['eid2'], severity: 'high', adapter_id: 'test' });
    await doInstance.release({ event_ids: ['eid2'], lane: res.lane, success: false, adapter_id: 'test' });
    const { delivered } = await doInstance.checkDelivered(['eid2']);
    expect(delivered).toHaveLength(0);
  });

  it('to_send_ids subset - already delivered filtered', async () => {
    // Mark eid1 delivered
    await doInstance.acquire({ event_ids: ['eid1'], severity: 'high', adapter_id: 'test' }).then((r: any) =>
      doInstance.release({ event_ids: ['eid1'], lane: r.lane, success: true, adapter_id: 'test' })
    );
    // Now acquire eid1+eid2
    const res = await doInstance.acquire({ event_ids: ['eid1', 'eid2'], severity: 'high', adapter_id: 'test' });
    expect(res.to_send_ids).toEqual(['eid2']);
    expect(res.to_send_ids).not.toContain('eid1');
  });

  it('all delivered -> to_send empty -> ack skip', async () => {
    await doInstance.acquire({ event_ids: ['eidX'], severity: 'high', adapter_id: 'test' }).then((r: any) =>
      doInstance.release({ event_ids: ['eidX'], lane: r.lane, success: true, adapter_id: 'test' })
    );
    const res = await doInstance.acquire({ event_ids: ['eidX'], severity: 'high', adapter_id: 'test' });
    expect(res.to_send_ids).toHaveLength(0);
  });

  it('lane_full when limits exceeded', async () => {
    // high_exclusive limit 1, elastic 4, total 5 for high path? Actually try allocate 6 times high
    const lanes: any[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await doInstance.acquire({ event_ids: [`e${i}`], severity: 'high', adapter_id: 'test' });
      if (r.allowed) lanes.push(r.lane);
    }
    // 1 high + 4 elastic = 5 allowed, 6th should be lane_full
    const over = await doInstance.acquire({ event_ids: ['overflow'], severity: 'high', adapter_id: 'test' });
    expect(over.allowed).toBe(false);
    expect((over as any).reason).toBe('lane_full');

    // Release one and try again -> should allow
    await doInstance.release({ event_ids: ['e0'], lane: lanes[0], success: true, adapter_id: 'test' });
    const after = await doInstance.acquire({ event_ids: ['overflow2'], severity: 'high', adapter_id: 'test' });
    expect(after.allowed).toBe(true);
  });

  it('circuit open after threshold and skip rewrite avalanche', async () => {
    const adapter = 'unstable-adapter';
    // Fail 5 times to trigger open (threshold 5)
    for (let i = 0; i < 5; i++) {
      const a = await doInstance.acquire({ event_ids: [`f${i}`], severity: 'high', adapter_id: adapter });
      await doInstance.release({ event_ids: [`f${i}`], lane: a.allowed ? (a as any).lane : 'high_exclusive', success: false, adapter_id: adapter });
    }
    const status = await doInstance.status();
    expect((status.circuit as any)[`circuit:${adapter}`]?.state ?? (Object.values(status.circuit)[0] as any)?.state).toBeDefined();

    // Next acquire should be circuit_open
    const blocked = await doInstance.acquire({ event_ids: ['next'], severity: 'high', adapter_id: adapter });
    expect(blocked.allowed).toBe(false);
    expect((blocked as any).reason).toBe('circuit_open');

    // Additional release(false) after open should NOT rewrite (skip)
    const before = await doInstance.status();
    const circBefore = Object.values(before.circuit)[0] as any;
    await doInstance.release({ event_ids: ['extra'], lane: 'high_exclusive', success: false, adapter_id: adapter });
    const after = await doInstance.status();
    const circAfter = Object.values(after.circuit)[0] as any;
    // Failures should stay same (skip rewrite)
    expect(circAfter.failures).toBe(circBefore.failures);
  });

  it('ghost-release safety: dec clamps to 0', async () => {
    // Simulate Hibernation loss: lane counter 0 but release called
    const res = await doInstance.acquire({ event_ids: ['ghost'], severity: 'high', adapter_id: 'test' });
    // Manually clear storage to simulate hibernation loss
    const counters = await (await import('../../src/coordinator/storage.js')).getLaneCounters((doInstance as any).storage ?? state.storage);
    // Force zero
    await (await import('../../src/coordinator/storage.js')).putLaneCounters((doInstance as any).storage ?? state.storage, {
      high_exclusive: 0,
      low_exclusive: 0,
      elastic: 0
    });
    // Release should clamp, not go negative
    await doInstance.release({ event_ids: ['ghost'], lane: res.lane, success: true, adapter_id: 'test' });
    const after = await (await import('../../src/coordinator/storage.js')).getLaneCounters((doInstance as any).storage ?? state.storage);
    expect(after.high_exclusive).toBe(0);
    expect(after.elastic).toBe(0);
  });
});
