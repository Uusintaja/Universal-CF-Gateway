import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLaneCounters,
  incLane,
  decLane,
  getCircuit,
  putCircuit,
  checkDelivered,
  writeDelivered,
  cleanupExpiredDelivered
} from '../../src/coordinator/storage.js';

// Minimal in-memory mock for DurableObjectStorage
function createMockStorage() {
  const map = new Map<string, any>();
  return {
    async get(key: string | string[]) {
      if (Array.isArray(key)) {
        const out = new Map();
        for (const k of key) if (map.has(k)) out.set(k, map.get(k));
        return out;
      }
      return map.get(key as string);
    },
    async put(key: any, val?: any) {
      if (typeof key === 'object' && val === undefined) {
        for (const [k, v] of Object.entries(key)) map.set(k, v);
      } else {
        map.set(key, val);
      }
    },
    async delete(key: string | string[]) {
      if (Array.isArray(key)) key.forEach((k) => map.delete(k));
      else map.delete(key);
    },
    async list(opts?: any) {
      const prefix = opts?.prefix ?? '';
      const limit = opts?.limit ?? 1000;
      const res = new Map();
      let c = 0;
      for (const [k, v] of map) {
        if (k.startsWith(prefix)) {
          res.set(k, v);
          c++;
          if (c >= limit) break;
        }
      }
      return res;
    }
  } as any;
}

describe('Coordinator storage - lane counters persistence (ghost-release fix)', () => {
  let storage: any;
  beforeEach(() => {
    storage = createMockStorage();
  });

  it('initial counters zero', async () => {
    const c = await getLaneCounters(storage);
    expect(c.high_exclusive).toBe(0);
    expect(c.low_exclusive).toBe(0);
    expect(c.elastic).toBe(0);
  });

  it('inc/dec persists and clamps to limits', async () => {
    await incLane(storage, 'high_exclusive');
    let c = await getLaneCounters(storage);
    expect(c.high_exclusive).toBe(1);
    // limit 1, inc beyond should clamp on put
    await incLane(storage, 'high_exclusive');
    c = await getLaneCounters(storage);
    expect(c.high_exclusive).toBe(1); // clamped to LANE_LIMITS.high_exclusive=1

    await decLane(storage, 'high_exclusive');
    c = await getLaneCounters(storage);
    expect(c.high_exclusive).toBe(0);

    // dec below 0 clamps to 0 (ghost-release safety)
    await decLane(storage, 'high_exclusive');
    c = await getLaneCounters(storage);
    expect(c.high_exclusive).toBe(0);
  });
});

describe('Coordinator storage - delivered markers with TTL lazy expiration', () => {
  let storage: any;
  beforeEach(() => {
    storage = createMockStorage();
  });

  it('write and check delivered', async () => {
    await writeDelivered(storage, ['eid1', 'eid2'], 1000);
    const { delivered, not_delivered } = await checkDelivered(storage, ['eid1', 'eid2', 'eid3']);
    expect(delivered).toEqual(expect.arrayContaining(['eid1', 'eid2']));
    expect(not_delivered).toContain('eid3');
  });

  it('expired markers treated as not delivered and cleaned', async () => {
    await writeDelivered(storage, ['old'], 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    const { delivered, not_delivered } = await checkDelivered(storage, ['old']);
    expect(delivered).toHaveLength(0);
    expect(not_delivered).toContain('old');
  });

  it('cleanupExpiredDelivered without full scan CPU blow', async () => {
    await writeDelivered(storage, ['a', 'b'], 1);
    await new Promise((r) => setTimeout(r, 10));
    const cleaned = await cleanupExpiredDelivered(storage, 10);
    expect(cleaned).toBeGreaterThanOrEqual(1);
  });
});

describe('Coordinator storage - circuit', () => {
  let storage: any;
  beforeEach(() => {
    storage = createMockStorage();
  });

  it('initial closed', async () => {
    const c = await getCircuit(storage, 'test-adapter');
    expect(c.state).toBe('closed');
    expect(c.failures).toBe(0);
  });

  it('circuit open persists', async () => {
    await putCircuit(storage, 'test-adapter', {
      state: 'open',
      failures: 5,
      opened_at: Date.now(),
      threshold: 5,
      openSec: 60
    });
    const c = await getCircuit(storage, 'test-adapter');
    expect(c.state).toBe('open');
  });
});
