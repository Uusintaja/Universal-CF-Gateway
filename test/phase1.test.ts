import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";
import type { CoordinatorRpc } from "../src/types";

describe("Phase 1 immediate webhook path", () => {
  const env = { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook" };
  const payload = {
    event_type: "notification",
    severity: "high" as const,
    title: "Phase 1 smoke event",
    body: { message: "synthetic" },
  };

  function coordinator(): CoordinatorRpc {
    return {
      acquire: async ({ event_ids }) => ({ allowed: true, lane: "high_exclusive", lease_id: "phase1-lease", to_send_ids: event_ids }),
      release: async () => undefined,
      status: async () => ({ circuit: "closed", consecutive_failures: 0, lane_usage: { high_exclusive: 0, low_exclusive: 0, elastic: 0 }, delivered_marker_count: 0, delivered_marker_ttl_sec: 1000 }),
      checkDelivered: async () => ({ delivered: [], not_delivered: [] }),
    };
  }

  it("sends the single-channel Phase 1 route", async () => {
    const fetchCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push([input, init]);
      return new Response("accepted", { status: 202 });
    });
    const originalBody = JSON.stringify(payload);
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), env, { fetchImpl, coordinator: coordinator() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "sent",
      attempts: 1,
      upstream_status: 202,
      route: { adapter_ids: ["http-webhook"], dispatch: "immediate" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestInit = fetchImpl.mock.calls[0]?.[1];
    expect(requestInit?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(requestInit?.body as Uint8Array)).toBe(originalBody);
  });

  it("does not pretend that an enqueue route is implemented", async () => {
    const response = await handleRequest(new Request("https://gateway.test/hooks/monitor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "heartbeat", severity: "info", title: "Low priority", body: {} }),
    }), env, { fetchImpl: vi.fn() });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: "ENQUEUE_NOT_IMPLEMENTED" });
  });

  it("rejects an immediate route whose adapter set is not implemented in Phase 1", async () => {
    const response = await handleRequest(new Request("https://gateway.test/hooks/github-ci", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "build.failed", severity: "high", title: "Failed", body: {} }),
    }), env, { fetchImpl: vi.fn() });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: "ADAPTER_NOT_IMPLEMENTED" });
  });

  it("fails clearly when the endpoint secret is missing", async () => {
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), {}, { fetchImpl: vi.fn() });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "CONFIGURATION_ERROR" });
  });
});
