import { describe, expect, it } from "vitest";
import { AlphaBatchWebhookAdapter, JsonWebhookAdapter } from "../src/adapters";
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
    raw_payload: {
      bytes: new TextEncoder().encode('{"commit":"abc"}'),
      content_type: "application/json",
    },
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
        body: message.items[0].raw_payload.bytes,
      },
    });
  });
});

describe("Alpha batch webhook adapter", () => {
  it("renders a batch envelope while preserving each raw payload as Base64", async () => {
    const adapter = new AlphaBatchWebhookAdapter();
    const batch = {
      ...message,
      target_adapter: "alpha-batch-webhook",
      items: [message.items[0], {
        ...message.items[0],
        event_id: "123e4567-e89b-42d3-a456-426614174001",
        raw_payload: {
          bytes: new TextEncoder().encode('{"second":true}'),
          content_type: "application/json",
        },
      }],
    };
    const rendered = await adapter.renderBatch(batch, {
      secrets: { endpoint: "https://channel.invalid/batch" },
      config: adapter.config,
    });
    const body = JSON.parse(String(rendered.request.body)) as { adapter: string; items: Array<{ raw_payload: { encoding: string; bytes: string } }> };

    expect(rendered.request.url).toBe("https://channel.invalid/batch");
    expect(body.adapter).toBe("alpha-batch-webhook");
    expect(body.items).toHaveLength(2);
    expect(body.items[0].raw_payload.encoding).toBe("base64");
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.items[1].raw_payload.bytes), (char) => char.charCodeAt(0)))).toBe('{"second":true}');
  });
});
