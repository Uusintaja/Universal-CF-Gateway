import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { handleRequest, processQueueBatch } from "../src/index";
import { toQueueEnvelope } from "../src/queue";
import type { CoordinatorRpc, Env, InternalEvent, QueueEnvelope } from "../src/types";

function event(): InternalEvent {
  return {
    schema_version: "1.0",
    event_id: "queue-event-1",
    source_id: "phase3-test",
    event_type: "notification",
    severity: "low",
    timestamp: "2026-07-12T00:00:00.000Z",
    title: "Queued notification",
    body: { message: "hello queue" },
    raw_payload: {
      bytes: new TextEncoder().encode('{"message":"hello queue"}'),
      content_type: "application/json",
    },
    trace: { gateway_trace: "trace-queue-1" },
    auth_context: null,
    metadata: {},
  };
}

function coordinator(): CoordinatorRpc {
  return {
    acquire: async ({ event_ids }) => ({ allowed: true, lane: "low_exclusive", lease_id: "queue-lease", to_send_ids: event_ids }),
    release: async () => undefined,
    status: async () => ({ circuit: "closed", consecutive_failures: 0, lane_usage: { high_exclusive: 0, low_exclusive: 0, elastic: 0 }, delivered_marker_count: 0, delivered_marker_ttl_sec: 1000 }),
    checkDelivered: async () => ({ delivered: [], not_delivered: [] }),
  };
}

describe("Phase 3A Queue path", () => {
  it("enqueues a low-priority event as a Base64 raw-payload envelope", async () => {
    const messages: QueueEnvelope[] = [];
    const queue: Queue<QueueEnvelope> = {
      send: async (message) => { messages.push(message); },
      sendBatch: async () => undefined,
    };
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase3-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "notification", severity: "low", title: "Queued", body: { ok: true } }),
    }), { HTTP_WEBHOOK_QUEUE: queue });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: "queued" });
    expect(messages).toHaveLength(1);
    expect(messages[0].raw_payload.encoding).toBe("base64");
    expect(new TextDecoder().decode(Uint8Array.from(atob(messages[0].raw_payload.bytes), (char) => char.charCodeAt(0)))).toContain('"ok":true');
  });

  it("consumes a Queue message, sends it, and explicitly acks it", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-http-webhook", [{
      id: "queue-message-1",
      timestamp: new Date(),
      attempts: 1,
      body: envelope,
    }]);
    const ctx = createExecutionContext();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe('{"message":"hello queue"}');
      return new Response("accepted", { status: 202 });
    });

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook" }, ctx, {
      coordinator: coordinator(),
      fetchImpl,
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["queue-message-1"]);
    expect(result.retryMessages).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
