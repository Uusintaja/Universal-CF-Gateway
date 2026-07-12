/**
 * CoordinatorDO Storage Helpers
 * Addresses Hibernation ghost-release: lane counters persisted, restored on init
 * Per DESIGN-DOC §4.2/§4.5 + discussion in 第四轮讨论第二节
 */

import type { LaneCounters, CircuitState } from './types.js';
import { LANE_LIMITS, CIRCUIT_DEFAULTS } from './constants.js';

const LANE_KEY = 'lane:counters';
const CIRCUIT_PREFIX = 'circuit:';
const DELIVERED_PREFIX = 'delivered:';
const COLD_PREFIX = 'coldpath:';

export async function getLaneCounters(storage: DurableObjectStorage): Promise<LaneCounters> {
  const val = (await storage.get(LANE_KEY)) as LaneCounters | undefined;
  return val ?? { high_exclusive: 0, low_exclusive: 0, elastic: 0 };
}

export async function putLaneCounters(storage: DurableObjectStorage, counters: LaneCounters): Promise<void> {
  // Clamp to avoid negative ghost
  const clamped: LaneCounters = {
    high_exclusive: Math.max(0, Math.min(LANE_LIMITS.high_exclusive, counters.high_exclusive)),
    low_exclusive: Math.max(0, Math.min(LANE_LIMITS.low_exclusive, counters.low_exclusive)),
    elastic: Math.max(0, Math.min(LANE_LIMITS.elastic, counters.elastic))
  };
  await storage.put(LANE_KEY, clamped);
}

export async function incLane(storage: DurableObjectStorage, lane: keyof LaneCounters): Promise<LaneCounters> {
  const counters = await getLaneCounters(storage);
  (counters as any)[lane] = ((counters as any)[lane] ?? 0) + 1;
  await putLaneCounters(storage, counters);
  return counters;
}

export async function decLane(storage: DurableObjectStorage, lane: keyof LaneCounters): Promise<LaneCounters> {
  const counters = await getLaneCounters(storage);
  (counters as any)[lane] = Math.max(0, ((counters as any)[lane] ?? 0) - 1);
  await putLaneCounters(storage, counters);
  return counters;
}

export function circuitKey(adapter: string): string {
  return `${CIRCUIT_PREFIX}${adapter}`;
}

export async function getCircuit(storage: DurableObjectStorage, adapter: string): Promise<CircuitState> {
  const key = circuitKey(adapter);
  const val = (await storage.get(key)) as CircuitState | undefined;
  return (
    val ?? {
      state: 'closed',
      failures: 0,
      threshold: CIRCUIT_DEFAULTS.threshold,
      openSec: CIRCUIT_DEFAULTS.openSec
    }
  );
}

export async function putCircuit(storage: DurableObjectStorage, adapter: string, state: CircuitState): Promise<void> {
  await storage.put(circuitKey(adapter), state);
}

export function deliveredKey(event_id: string): string {
  return `${DELIVERED_PREFIX}${event_id}`;
}

export async function checkDelivered(
  storage: DurableObjectStorage,
  event_ids: string[]
): Promise<{ delivered: string[]; not_delivered: string[] }> {
  const now = Date.now();
  const delivered: string[] = [];
  const not_delivered: string[] = [];

  // Lazy expiration on read: if expired, treat as not delivered and delete
  for (const id of event_ids) {
    const key = deliveredKey(id);
    const entry = (await storage.get(key)) as { expires_at: number } | undefined;
    if (!entry) {
      not_delivered.push(id);
    } else if (entry.expires_at < now) {
      // Expired -> clean and treat as not delivered (design intent §4.5)
      await storage.delete(key);
      not_delivered.push(id);
    } else {
      delivered.push(id);
    }
  }
  return { delivered, not_delivered };
}

export async function writeDelivered(
  storage: DurableObjectStorage,
  event_ids: string[],
  ttlMs: number
): Promise<void> {
  const now = Date.now();
  const expires_at = now + ttlMs;
  const batch: Record<string, any> = {};
  for (const id of event_ids) {
    batch[deliveredKey(id)] = { event_id: id, ts: now, expires_at };
  }
  await storage.put(batch);
}

export async function cleanupExpiredDelivered(storage: DurableObjectStorage, limit = 100): Promise<number> {
  // Avoid full list scan CPU >10ms, use prefix list with limit
  const list = await storage.list({ prefix: DELIVERED_PREFIX, limit });
  let cleaned = 0;
  const now = Date.now();
  for (const [key, val] of list) {
    const entry = val as any;
    if (entry?.expires_at && entry.expires_at < now) {
      await storage.delete(key);
      cleaned++;
    }
  }
  return cleaned;
}

export function coldKey(kind: string, adapter: string, nonce: string): string {
  return `${COLD_PREFIX}${kind}:${adapter}:${nonce}`;
}
