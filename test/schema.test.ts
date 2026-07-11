import { describe, expect, it } from "vitest";
import { InternalEventSchema } from "../src/schema";

describe("internal event schema", () => {
  it("accepts the documented event shape and preserves custom auth claims", () => {
    const result = InternalEventSchema.safeParse({
      schema_version: "1.0",
      event_id: "123e4567-e89b-12d3-a456-426614174000",
      source_id: "monitor",
      event_type: "heartbeat",
      severity: "info",
      timestamp: "2026-07-11T00:00:00.000Z",
      title: "Healthy",
      body: { ok: true },
      trace: { gateway_trace: "trace-1" },
      auth_context: { source_id: "monitor", verified: true, tenant: "alpha" },
      metadata: {},
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auth_context).toMatchObject({ tenant: "alpha" });
  });

  it("rejects an unsupported severity", () => {
    const result = InternalEventSchema.safeParse({
      schema_version: "1.0",
      event_id: "123e4567-e89b-12d3-a456-426614174000",
      source_id: "monitor",
      event_type: "heartbeat",
      severity: "urgent",
      timestamp: "2026-07-11T00:00:00.000Z",
      title: "Bad",
      body: {},
      trace: { gateway_trace: "trace-2" },
      auth_context: null,
      metadata: {},
    });

    expect(result.success).toBe(false);
  });
});
