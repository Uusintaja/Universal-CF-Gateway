import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CoordinatorRpc } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    COORDINATOR: DurableObjectNamespace;
  }
}

function coordinatorFor(testName: string): CoordinatorRpc {
  const namespace = env.COORDINATOR;
  if (!namespace) throw new Error("COORDINATOR binding is unavailable");
  const id = namespace.idFromName(`test-${testName}-${crypto.randomUUID()}`);
  return namespace.get(id) as unknown as CoordinatorRpc;
}

describe("CoordinatorDO", () => {
  it("allows a first event, marks it delivered on success, and deduplicates it", async () => {
    const coordinator = coordinatorFor("dedupe");
    const first = await coordinator.acquire({ event_ids: ["event-1"], severity: "high" });

    expect(first).toMatchObject({ allowed: true, lane: "high_exclusive", to_send_ids: ["event-1"] });
    if (!first.allowed || !first.lease_id) throw new Error("expected an active lease");
    await coordinator.release({ lease_id: first.lease_id, success: true });

    await expect(coordinator.checkDelivered(["event-1", "event-2"])).resolves.toEqual({
      delivered: ["event-1"],
      not_delivered: ["event-2"],
    });
    await expect(coordinator.acquire({ event_ids: ["event-1"], severity: "high" })).resolves.toEqual({
      allowed: true,
      lane: null,
      lease_id: null,
      to_send_ids: [],
    });
  });

  it("does not mark a failed send as delivered and permits retry", async () => {
    const coordinator = coordinatorFor("retry");
    const first = await coordinator.acquire({ event_ids: ["event-retry"], severity: "high" });
    if (!first.allowed || !first.lease_id) throw new Error("expected an active lease");
    await coordinator.release({ lease_id: first.lease_id, success: false });

    const retry = await coordinator.acquire({ event_ids: ["event-retry"], severity: "high" });
    expect(retry).toMatchObject({ allowed: true, to_send_ids: ["event-retry"] });
  });

  it("allows only one concurrent lease for the same event", async () => {
    const coordinator = coordinatorFor("inflight");
    const results = await Promise.all(Array.from({ length: 10 }, () => coordinator.acquire({
      event_ids: ["event-concurrent"],
      severity: "high",
    })));

    const senders = results.filter((result) => result.allowed && result.to_send_ids.includes("event-concurrent"));
    expect(senders).toHaveLength(1);
    const active = senders[0];
    if (!active.allowed || !active.lease_id) throw new Error("expected an active lease");
    await coordinator.release({ lease_id: active.lease_id, success: false });
  });

  it("keeps exclusive lanes isolated and caps elastic capacity", async () => {
    const coordinator = coordinatorFor("lanes");
    const high = await coordinator.acquire({ event_ids: ["high-1"], severity: "high" });
    const low = await coordinator.acquire({ event_ids: ["low-1"], severity: "low" });
    const extraHigh = await Promise.all(Array.from({ length: 5 }, (_, index) => coordinator.acquire({
      event_ids: [`extra-${index}`],
      severity: "high",
    })));

    expect(high).toMatchObject({ allowed: true, lane: "high_exclusive" });
    expect(low).toMatchObject({ allowed: true, lane: "low_exclusive" });
    expect(extraHigh.filter((result) => result.allowed && result.lane === "elastic")).toHaveLength(4);
    expect(extraHigh.filter((result) => !result.allowed)).toHaveLength(1);

    const leases = [high, low, ...extraHigh].filter((result): result is Extract<typeof result, { allowed: true }> => result.allowed && result.lease_id !== null);
    await Promise.all(leases.map((lease) => coordinator.release({ lease_id: lease.lease_id as string, success: false })));
    const status = await coordinator.status();
    expect(status.lane_usage).toEqual({ high_exclusive: 0, low_exclusive: 0, elastic: 0 });
  });

  it("archives and queries cold-path records in the DO", async () => {
    const coordinator = coordinatorFor("cold-path");
    const archived = await coordinator.archiveColdPath({
      kind: "dlq",
      adapter: "alpha-batch-webhook",
      reason: "upstream failed",
      attempts: 4,
      event_id: "cold-event-1",
      source_id: "phase3-test",
      payload: { failed: true },
      raw_payload: { encoding: "base64", bytes: "eA==", content_type: "application/json" },
      trace: { gateway_trace: "trace-cold" },
      received_at: "2026-07-12T00:00:00.000Z",
    });

    expect(archived.key).toContain("coldpath:dlq:alpha-batch-webhook:");
    await expect(coordinator.queryColdPath({ kind: "dlq", adapter: "alpha-batch-webhook", since: "2026-07-11T00:00:00.000Z", limit: 10 })).resolves.toMatchObject({
      entries: [{ event_id: "cold-event-1", raw_payload: { encoding: "base64", bytes: "eA==" } }],
    });
  });

  it("opens the circuit after three failures and closes it after a successful probe", async () => {
    const coordinator = coordinatorFor("circuit");
    for (let index = 0; index < 3; index += 1) {
      const result = await coordinator.acquire({ event_ids: [`failure-${index}`], severity: "high" });
      if (!result.allowed || !result.lease_id) throw new Error("expected an active lease");
      await coordinator.release({ lease_id: result.lease_id, success: false });
    }

    await expect(coordinator.status()).resolves.toMatchObject({ circuit: "open", consecutive_failures: 3 });
    await expect(coordinator.acquire({ event_ids: ["blocked"], severity: "high" })).resolves.toEqual({
      allowed: false,
      reason: "circuit_open",
    });
  });
});
