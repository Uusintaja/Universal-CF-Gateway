import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";
import type { CoordinatorRpc } from "../src/types";

function coordinator(sampled: boolean): CoordinatorRpc {
  return {
    acquire: async () => ({ allowed: true, lane: null, lease_id: null, to_send_ids: [] }),
    release: async () => undefined,
    status: async () => ({ circuit: "closed", consecutive_failures: 0, lane_usage: { high_exclusive: 0, low_exclusive: 0, elastic: 0 }, delivered_marker_count: 0, delivered_marker_ttl_sec: 1000 }),
    checkDelivered: async () => ({ delivered: [], not_delivered: [] }),
    archiveColdPath: async () => ({ key: "coldpath:test" }),
    queryColdPath: async () => ({ entries: [] }),
    recordUnmatchedSample: async () => ({
      sampled,
      count: sampled ? 1 : 2,
      key: "coldpath:unmatched:phase1-test:window",
      entry: sampled ? {
        key: "coldpath:unmatched:phase1-test:window",
        kind: "unmatched",
        reason: "no route matched",
        source_id: "phase1-test",
        event_id: "unmatched-event",
        payload: { unknown: true },
        raw_payload: { encoding: "base64", bytes: "eA==", content_type: "application/json" },
        received_at: "2026-07-12T00:00:00.000Z",
        sample_count: 1,
      } : undefined,
    }),
  };
}

describe("Phase 4B unmatched sampling", () => {
  it("returns 202, records the sample, and schedules KV export", async () => {
    const pending: Promise<unknown>[] = [];
    const put = vi.fn(async () => undefined);
    const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext;
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "unmatched", severity: "high", title: "Unknown", body: { unknown: true } }),
    }), {
      COLD_PATH_KV: { put } as unknown as KVNamespace,
    }, {
      coordinator: coordinator(true),
      executionContext: ctx,
    });
    await Promise.all(pending);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: "unmatched", sampled: true });
    expect(put).toHaveBeenCalledWith("coldpath:unmatched:phase1-test:window", expect.any(String), { expirationTtl: 7 * 24 * 60 * 60 });
  });

  it("returns 202 without another KV sample after the window already has one", async () => {
    const put = vi.fn(async () => undefined);
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "unmatched", severity: "high", title: "Unknown", body: { unknown: true } }),
    }), {
      COLD_PATH_KV: { put } as unknown as KVNamespace,
    }, {
      coordinator: coordinator(false),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: "unmatched", sampled: false });
    expect(put).not.toHaveBeenCalled();
  });
});
