import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";

describe("Phase 1 immediate webhook path", () => {
  const env = { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook" };
  const payload = {
    event_type: "notification",
    severity: "high",
    title: "Phase 1 smoke event",
    body: { message: "synthetic" },
  };

  it("sends the single-channel Phase 1 route", async () => {
    const fetchImpl = vi.fn(async () => new Response("accepted", { status: 202 }));
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }), env, { fetchImpl });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "sent",
      attempts: 1,
      upstream_status: 202,
      route: { adapter_ids: ["http-webhook"], dispatch: "immediate" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
