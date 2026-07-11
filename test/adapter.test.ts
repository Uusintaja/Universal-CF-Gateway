import { describe, expect, it } from "vitest";
import { JsonWebhookAdapter } from "../src/adapters";
import type { InternalPushMessage } from "../src/types";

const message: InternalPushMessage = {
  schema_version: "1.0",
  message_id: "123e4567-e89b-12d3-a456-426614174000",
  target_adapter: "slack-webhook",
  severity: "high",
  items: [{
    event_id: "123e4567-e89b-12d3-a456-426614174000",
    title: "Build failed",
    body: { commit: "abc" },
    severity: "high",
    timestamp: "2026-07-11T00:00:00.000Z",
    trace: { gateway_trace: "trace-1" },
  }],
  chunk: { index: 0, total: 1 },
  attempt: 0,
  created_at: "2026-07-11T00:00:00.000Z",
};

describe("JSON webhook adapter", () => {
  it("renders a TransportRequest without performing network I/O", async () => {
    const adapter = new JsonWebhookAdapter("slack-webhook");
    const rendered = await adapter.render(message, {
      secrets: { endpoint: "https://channel.invalid/hook" },
      config: adapter.config,
    });

    expect(rendered).toEqual({
      transport: "http",
      request: {
        method: "POST",
        url: "https://channel.invalid/hook",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      },
    });
  });
});
