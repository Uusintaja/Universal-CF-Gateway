import { DurableObject } from "cloudflare:workers";
import type {
  AcquireInput,
  AcquireResult,
  ColdPathEntry,
  ColdPathQuery,
  ColdPathQueryResult,
  CoordinatorRpc,
  CoordinatorStatus,
  Env,
  Lane,
  ReleaseInput,
  Severity,
  UnmatchedSampleInput,
  UnmatchedSampleResult,
} from "./types";

const LANE_CAPACITY: Record<Lane, number> = {
  high_exclusive: 1,
  low_exclusive: 1,
  elastic: 4,
};

const DELIVERED_TTL_SECONDS = 1_000;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_SECONDS = 60;

interface LaneUsage {
  high_exclusive: number;
  low_exclusive: number;
  elastic: number;
}

interface StoredLease {
  lane: Lane;
  event_ids: string[];
  probe: boolean;
}

interface StoredDelivered {
  delivered_at: number;
  expires_at: number;
}

interface StoredCircuit {
  status: "closed" | "open" | "half_open";
  consecutive_failures: number;
  open_until?: number;
  probe_lease_id?: string;
}

const EMPTY_USAGE: LaneUsage = {
  high_exclusive: 0,
  low_exclusive: 0,
  elastic: 0,
};

function primaryLane(severity: Severity): "high_exclusive" | "low_exclusive" {
  return severity === "critical" || severity === "high" ? "high_exclusive" : "low_exclusive";
}

function uniqueEventIds(eventIds: string[]): string[] {
  return [...new Set(eventIds.filter((eventId) => eventId.length > 0))];
}

function chooseLane(usage: LaneUsage, severity: Severity): Lane | null {
  const primary = primaryLane(severity);
  if (usage[primary] < LANE_CAPACITY[primary]) return primary;
  if (usage.elastic < LANE_CAPACITY.elastic) return "elastic";
  return null;
}

function initialCircuit(): StoredCircuit {
  return { status: "closed", consecutive_failures: 0 };
}

export class CoordinatorDO extends DurableObject implements CoordinatorRpc {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
  }

  async acquire(input: AcquireInput): Promise<AcquireResult> {
    const eventIds = uniqueEventIds(input.event_ids);
    if (eventIds.length === 0) {
      return { allowed: true, lane: null, lease_id: null, to_send_ids: [] };
    }

    return this.state.storage.transaction(async (transaction) => {
      const deliveredKeys = eventIds.map((eventId) => `delivered:${eventId}`);
      const inflightKeys = eventIds.map((eventId) => `inflight:${eventId}`);
      const stored = await transaction.get([...deliveredKeys, ...inflightKeys]);
      const now = Date.now();
      for (const eventId of eventIds) {
        const marker = stored.get(`delivered:${eventId}`) as StoredDelivered | undefined;
        if (marker && marker.expires_at <= now) {
          await transaction.delete(`delivered:${eventId}`);
          stored.delete(`delivered:${eventId}`);
        }
      }
      const pending = eventIds.filter((eventId) =>
        !stored.has(`delivered:${eventId}`) && !stored.has(`inflight:${eventId}`));

      // A duplicate that is already delivered or currently leased needs no lane.
      if (pending.length === 0) {
        return { allowed: true, lane: null, lease_id: null, to_send_ids: [] };
      }

      const circuit = await transaction.get<StoredCircuit>("circuit") ?? initialCircuit();
      let probe = false;

      if (circuit.status === "open") {
        if ((circuit.open_until ?? 0) > now) {
          return { allowed: false, reason: "circuit_open" };
        }
        probe = true;
      } else if (circuit.status === "half_open") {
        if (circuit.probe_lease_id) return { allowed: false, reason: "circuit_open" };
        probe = true;
      }

      const usage = await transaction.get<LaneUsage>("lane:usage") ?? { ...EMPTY_USAGE };
      const lane = chooseLane(usage, input.severity);
      if (lane === null) return { allowed: false, reason: "lane_full" };

      const leaseId = crypto.randomUUID();
      usage[lane] += 1;
      await transaction.put("lane:usage", usage);
      await transaction.put(`lease:${leaseId}`, { lane, event_ids: pending, probe } satisfies StoredLease);
      for (const eventId of pending) {
        await transaction.put(`inflight:${eventId}`, leaseId);
      }
      if (probe) {
        await transaction.put("circuit", { ...circuit, status: "half_open", probe_lease_id: leaseId } satisfies StoredCircuit);
      }

      return { allowed: true, lane, lease_id: leaseId, to_send_ids: pending };
    });
  }

  async release(input: ReleaseInput): Promise<void> {
    await this.state.storage.transaction(async (transaction) => {
      const lease = await transaction.get<StoredLease>(`lease:${input.lease_id}`);
      // Release is intentionally idempotent: duplicate callbacks cannot underflow a lane.
      if (!lease) return;

      const usage = await transaction.get<LaneUsage>("lane:usage") ?? { ...EMPTY_USAGE };
      usage[lease.lane] = Math.max(0, usage[lease.lane] - 1);
      await transaction.put("lane:usage", usage);
      await transaction.delete(`lease:${input.lease_id}`);
      await transaction.delete(lease.event_ids.map((eventId) => `inflight:${eventId}`));

      const circuit = await transaction.get<StoredCircuit>("circuit") ?? initialCircuit();
      if (input.success) {
        const deliveredAt = Date.now();
        for (const eventId of lease.event_ids) {
          await transaction.put(`delivered:${eventId}`, {
            delivered_at: deliveredAt,
            expires_at: deliveredAt + DELIVERED_TTL_SECONDS * 1_000,
          } satisfies StoredDelivered);
        }
        const nextCircuit: StoredCircuit = {
          status: "closed",
          consecutive_failures: 0,
        };
        await transaction.put("circuit", nextCircuit);
        if (circuit.status !== nextCircuit.status) {
          console.log(JSON.stringify({ level: "info", event: "circuit_state_change", from: circuit.status, to: nextCircuit.status, failure_count: 0 }));
        }
        return;
      }

      const failures = circuit.consecutive_failures + 1;
      const shouldOpen = lease.probe || failures >= CIRCUIT_THRESHOLD;
      const nextCircuit: StoredCircuit = shouldOpen
        ? {
            status: "open",
            consecutive_failures: failures,
            open_until: Date.now() + CIRCUIT_OPEN_SECONDS * 1_000,
          }
        : {
            status: "closed",
            consecutive_failures: failures,
          };
      await transaction.put("circuit", nextCircuit);
      if (circuit.status !== nextCircuit.status) {
        console.log(JSON.stringify({ level: "warn", event: "circuit_state_change", from: circuit.status, to: nextCircuit.status, failure_count: failures }));
      }
    });
  }

  async status(): Promise<CoordinatorStatus> {
    const usage = await this.state.storage.get<LaneUsage>("lane:usage") ?? { ...EMPTY_USAGE };
    const circuit = await this.state.storage.get<StoredCircuit>("circuit") ?? initialCircuit();
    const delivered = await this.state.storage.list<StoredDelivered>({ prefix: "delivered:" });
    const now = Date.now();
    const activeDeliveredCount = [...delivered.values()].filter((marker) => marker.expires_at > now).length;
    return {
      circuit: circuit.status,
      consecutive_failures: circuit.consecutive_failures,
      open_until: circuit.open_until,
      lane_usage: usage,
      delivered_marker_count: activeDeliveredCount,
      delivered_marker_ttl_sec: DELIVERED_TTL_SECONDS,
    };
  }

  async checkDelivered(eventIds: string[]): Promise<{ delivered: string[]; not_delivered: string[] }> {
    const uniqueIds = uniqueEventIds(eventIds);
    const stored = await this.state.storage.get<StoredDelivered>(uniqueIds.map((eventId) => `delivered:${eventId}`));
    const now = Date.now();
    const delivered = uniqueIds.filter((eventId) => {
      const marker = stored.get(`delivered:${eventId}`);
      return marker !== undefined && marker.expires_at > now;
    });
    return {
      delivered,
      not_delivered: uniqueIds.filter((eventId) => !delivered.includes(eventId)),
    };
  }

  async archiveColdPath(entry: ColdPathEntry): Promise<{ key: string }> {
    const adapter = entry.adapter ?? "unmatched";
    const key = `coldpath:${entry.kind}:${adapter}:${crypto.randomUUID()}`;
    await this.state.storage.put(key, entry);
    return { key };
  }

  async queryColdPath(query: ColdPathQuery): Promise<ColdPathQueryResult> {
    const prefix = query.kind
      ? `coldpath:${query.kind}:${query.adapter ?? ""}`
      : "coldpath:";
    const stored = await this.state.storage.list<ColdPathEntry>({
      prefix,
      startAfter: query.cursor,
      limit: Math.max(1, Math.min(query.limit, 100)),
    });
    const entries = [...stored.entries()]
      .filter(([, entry]) => entry.received_at >= query.since)
      .map(([key, entry]) => ({ ...entry, key }));
    const nextCursor = stored.size >= query.limit ? [...stored.keys()].at(-1) : undefined;
    return { entries, nextCursor };
  }

  async recordUnmatchedSample(input: UnmatchedSampleInput): Promise<UnmatchedSampleResult> {
    const windowStart = Math.floor(Date.now() / (5 * 60 * 1_000)) * (5 * 60 * 1_000);
    const key = `coldpath:unmatched:${input.source_id}:${windowStart}`;
    return this.state.storage.transaction(async (transaction) => {
      const existing = await transaction.get<ColdPathEntry & { key: string }>(key);
      if (existing) {
        const updated = {
          ...existing,
          sample_count: (existing.sample_count ?? 1) + 1,
          last_seen_at: input.received_at,
        };
        await transaction.put(key, updated);
        return { sampled: false, count: updated.sample_count ?? 1, key };
      }

      const entry: ColdPathEntry & { key: string } = {
        key,
        kind: "unmatched",
        reason: "no route matched",
        source_id: input.source_id,
        event_id: input.event_id,
        payload: input.payload,
        raw_payload: input.raw_payload,
        trace: input.trace,
        received_at: input.received_at,
        first_seen_at: input.received_at,
        last_seen_at: input.received_at,
        sample_count: 1,
      };
      await transaction.put(key, entry);
      return { sampled: true, count: 1, key, entry };
    });
  }

  async fetch(): Promise<Response> {
    return new Response("CoordinatorDO is RPC-only", { status: 404 });
  }
}
