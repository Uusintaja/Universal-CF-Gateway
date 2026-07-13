import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";
import { ROUTING_TABLE } from "../src/router";
import { resolveSource, SOURCE_REGISTRY } from "../src/source";

describe("source_id contract", () => {
  it("prefers a matching path/header source and returns the canonical source key", () => {
    const result = resolveSource(new Request("https://gateway.test/hooks/phase1-test", {
      headers: { "x-gateway-source": "phase1-test" },
    }));
    expect(result).toEqual({
      ok: true,
      source: expect.objectContaining({ id: "phase1-test" }),
      key: "source:phase1-test",
      keyStrategy: "source_id",
    });
  });

  it("rejects conflicting path and header source ids", () => {
    expect(resolveSource(new Request("https://gateway.test/hooks/phase1-test", {
      headers: { "x-gateway-source": "monitor" },
    }))).toMatchObject({ ok: false, code: "SOURCE_CONFLICT", status: 400, keyStrategy: "global" });
  });

  it("uses the global key for unknown or missing sources", () => {
    expect(resolveSource(new Request("https://gateway.test/hooks/unknown", {
      headers: { "x-gateway-source": "unknown" },
    }))).toMatchObject({ ok: false, code: "SOURCE_UNKNOWN", status: 404, keyStrategy: "global" });
    expect(resolveSource(new Request("https://gateway.test/hooks"))).toMatchObject({
      ok: false,
      code: "SOURCE_REQUIRED",
      status: 400,
      key: "missing-source:/hooks",
    });
  });

  it("keeps Router source rules registered", () => {
    const routeSources = ROUTING_TABLE.rules
      .map((rule) => rule.match.source_id)
      .filter((source): source is string => source !== undefined);
    expect(routeSources.every((source) => SOURCE_REGISTRY[source])).toBe(true);
  });
});

describe("official Rate Limiting gate", () => {
  it("returns 429 before decoding when the source limiter denies", async () => {
    const sourceLimiter = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }), {}, { sourceLimiter, requireRateLimit: true });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "RATE_LIMITED" });
  });

  it("uses the global limiter for an unknown source", async () => {
    const globalLimiter = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit;
    const response = await handleRequest(new Request("https://gateway.test/hooks/unknown", {
      method: "POST",
      body: "{}",
    }), {}, { globalLimiter, requireRateLimit: true });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "SOURCE_UNKNOWN" });
    expect(globalLimiter.limit).toHaveBeenCalledWith({ key: "missing-source:/hooks/unknown" });
  });

  it("returns 503 rather than silently bypassing a required limiter", async () => {
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase1-test", {
      method: "POST",
      body: "{}",
    }), {}, { requireRateLimit: true });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "RATE_LIMITER_NOT_CONFIGURED" });
  });
});
