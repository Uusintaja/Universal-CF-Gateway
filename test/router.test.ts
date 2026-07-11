import { describe, expect, it } from "vitest";
import { router } from "../src/router";
import type { InternalEvent } from "../src/types";

function event(overrides: Partial<InternalEvent> = {}): InternalEvent {
  return {
    schema_version: "1.0",
    event_id: "123e4567-e89b-12d3-a456-426614174000",
    source_id: "github-ci",
    event_type: "build.failed",
    severity: "high",
    timestamp: "2026-07-11T00:00:00.000Z",
    title: "Build failed",
    body: {},
    trace: { gateway_trace: "trace-1" },
    auth_context: null,
    metadata: {},
    ...overrides,
  };
}

describe("router", () => {
  it("routes a high-severity GitHub failure to all immediate adapters", () => {
    expect(router.route(event())).toEqual({
      adapter_ids: ["slack-webhook", "email-mailchannels"],
      dispatch: "immediate",
      strategy: "all",
    });
  });

  it("uses the monitor failover rule", () => {
    expect(router.route(event({ source_id: "monitor", event_type: "heartbeat", severity: "high" }))).toEqual({
      adapter_ids: ["slack-webhook", "email-mailchannels"],
      dispatch: "immediate",
      strategy: "first_success",
    });
  });

  it("returns null for an unmatched event", () => {
    expect(router.route(event({ source_id: "unknown", event_type: "unknown", severity: "info" }))).toBeNull();
  });
});
