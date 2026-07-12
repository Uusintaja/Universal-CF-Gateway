/**
 * CoordinatorDO - Phase 2 core
 * Per DESIGN-DOC §4.2 + invariants from 第四轮讨论
 * - acquire only read check delivered, not write (P0)
 * - release success true writes delivered with TTL ~1000s
 * - lane counters persisted to survive Hibernation ghost-release
 * - circuit open only once, subsequent release(false) after open skip rewrite (avoid 95 rewrites snow)
 */

import { LANE_LIMITS, LANE_ALLOCATION, CIRCUIT_DEFAULTS, DEDUP_TTL_MS } from './constants.js';
import type { Lane } from './constants.js';
import type { AcquirePayload, AcquireResult, ReleasePayload, ColdPathEntry } from './types.js';
import {
  getLaneCounters,
  incLane,
  decLane,
  getCircuit,
  putCircuit,
  checkDelivered,
  writeDelivered,
  cleanupExpiredDelivered,
  coldKey
} from './storage.js';

export class CoordinatorDO implements DurableObject {
  private storage: DurableObjectStorage;
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  private laneFor(severity: any): Lane {
    const alloc = (LANE_ALLOCATION as any)[severity] ?? LANE_ALLOCATION['low'];
    return alloc.primary as Lane;
  }

  private tryAllocateLane(counters: any, desired: Lane): Lane | null {
    // Try primary first
    if (counters[desired] < (LANE_LIMITS as any)[desired]) {
      return desired;
    }
    // Overflow to elastic
    if (desired !== 'elastic' && counters['elastic'] < LANE_LIMITS.elastic) {
      return 'elastic';
    }
    return null;
  }

  async acquire(payload: AcquirePayload): Promise<AcquireResult> {
    const { event_ids, severity, adapter_id } = payload;
    const adapter = adapter_id ?? 'default';

    // 1. Circuit check (fail-fast)
    const circuit = await getCircuit(this.storage, adapter);
    if (circuit.state === 'open') {
      const now = Date.now();
      const openedAt = circuit.opened_at ?? 0;
      if (now - openedAt < circuit.openSec * 1000) {
        return { allowed: false, reason: 'circuit_open' };
      }
      // Expired -> close circuit
      await putCircuit(this.storage, adapter, {
        state: 'closed',
        failures: 0,
        threshold: circuit.threshold,
        openSec: circuit.openSec
      });
    }

    // 2. Dedup read-only check (P0 invariant)
    // Lazy cleanup a small batch to avoid CPU blow
    if (Math.random() < 0.1) {
      // 10% chance cleanup 50 expired markers
      await cleanupExpiredDelivered(this.storage, 50).catch(() => {});
    }
    const { not_delivered } = await checkDelivered(this.storage, event_ids);
    const to_send_ids = not_delivered;

    if (to_send_ids.length === 0) {
      // All already delivered -> ack skip
      return { allowed: true, lane: this.laneFor(severity), to_send_ids: [] };
    }

    // 3. Lane allocation with persisted counters
    const counters = await getLaneCounters(this.storage);
    const desired = this.laneFor(severity);
    const allocated = this.tryAllocateLane(counters, desired);

    if (!allocated) {
      return { allowed: false, reason: 'lane_full' };
    }

    await incLane(this.storage, allocated);

    return { allowed: true, lane: allocated, to_send_ids };
  }

  async release(payload: ReleasePayload): Promise<void> {
    const { event_ids, lane, success, adapter_id } = payload;
    const adapter = adapter_id ?? 'default';

    // Always release lane (decrement, clamp to 0)
    await decLane(this.storage, lane as any).catch(() => {});

    if (success) {
      // Only on success write delivered marker (P0)
      await writeDelivered(this.storage, event_ids, DEDUP_TTL_MS).catch(() => {});

      // On success, reset circuit failures
      const circuit = await getCircuit(this.storage, adapter);
      if (circuit.failures > 0 || circuit.state === 'open') {
        await putCircuit(this.storage, adapter, {
          state: 'closed',
          failures: 0,
          threshold: circuit.threshold,
          openSec: circuit.openSec
        }).catch(() => {});
      }
    } else {
      // Failure path: update circuit counter
      const circuit = await getCircuit(this.storage, adapter);
      if (circuit.state === 'open') {
        // Already open -> skip rewrite to avoid 95 rewrites avalanche
        return;
      }
      const failures = (circuit.failures ?? 0) + 1;
      if (failures >= circuit.threshold) {
        // Transition closed->open only once
        await putCircuit(this.storage, adapter, {
          state: 'open',
          failures,
          opened_at: Date.now(),
          threshold: circuit.threshold,
          openSec: circuit.openSec
        }).catch(() => {});
      } else {
        await putCircuit(this.storage, adapter, {
          ...circuit,
          failures
        }).catch(() => {});
      }
    }
  }

  async archiveColdPath(entry: ColdPathEntry): Promise<void> {
    const nonce = crypto.randomUUID();
    const key = coldKey(entry.kind, entry.adapter ?? 'unknown', nonce);
    await this.storage.put(key, { ...entry, received_at: entry.received_at ?? new Date().toISOString() });
  }

  async queryColdPath(opts: { kind?: string; since: string; limit: number; cursor?: string }): Promise<{ entries: any[]; nextCursor?: string }> {
    const prefix = opts.kind ? `coldpath:${opts.kind}:` : 'coldpath:';
    const list = await this.storage.list({ prefix, limit: opts.limit });
    const entries = Array.from(list.values());
    return { entries };
  }

  async status(): Promise<any> {
    const counters = await getLaneCounters(this.storage);
    const listCircuits = await this.storage.list({ prefix: 'circuit:' });
    const circuits: any = {};
    for (const [k, v] of listCircuits) {
      circuits[k] = v;
    }
    const deliveredList = await this.storage.list({ prefix: 'delivered:', limit: 100 });
    return {
      circuit: circuits,
      lane_usage: counters,
      delivered_marker_count: deliveredList.size,
      delivered_marker_ttl_ms: DEDUP_TTL_MS
    };
  }

  async checkDelivered(event_ids: string[]): Promise<{ delivered: string[]; not_delivered: string[] }> {
    return checkDelivered(this.storage, event_ids);
  }

  // For Miniflare fetch compatibility (RPC via fetch is alternative, but we use direct method calls in tests)
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/acquire')) {
      const body = (await req.json()) as any;
      const res = await this.acquire(body as any);
      return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/release')) {
      const body = (await req.json()) as any;
      await this.release(body as any);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/status')) {
      const s = await this.status();
      return new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('CoordinatorDO experimental - RPC methods: acquire/release/status/checkDelivered/archiveColdPath', { status: 200 });
  }
}
