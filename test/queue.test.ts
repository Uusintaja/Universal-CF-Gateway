import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { handleRequest, processQueueBatch, queueRetryDelay } from "../src/index";
import { buildPushChunks, toQueueEnvelope } from "../src/queue";
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
    archiveColdPath: async () => ({ key: "coldpath:test" }),
    queryColdPath: async () => ({ entries: [] }),
    recordUnmatchedSample: async () => ({ sampled: false, count: 0, key: "" }),
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

  it("enqueues a batch-adapter event to its alpha-specific Queue", async () => {
    const messages: QueueEnvelope[] = [];
    const queue: Queue<QueueEnvelope> = {
      send: async (message) => { messages.push(message); },
      sendBatch: async () => undefined,
    };
    const response = await handleRequest(new Request("https://gateway.test/hooks/phase3-batch-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "notification", severity: "low", title: "Batch queued", body: { ok: true } }),
    }), { ALPHA_BATCH_WEBHOOK_QUEUE: queue });

    expect(response.status).toBe(202);
    expect(messages[0].adapter_id).toBe("alpha-batch-webhook");
  });

  it("merges two Queue messages for a batch-capable adapter and acks both", async () => {
    const first = toQueueEnvelope(event(), "alpha-batch-webhook");
    const second = toQueueEnvelope(event(), "alpha-batch-webhook");
    second.event_id = "queue-event-2";
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-batch-webhook", [
      { id: "batch-message-1", timestamp: new Date(), attempts: 1, body: first },
      { id: "batch-message-2", timestamp: new Date(), attempts: 1, body: second },
    ]);
    const ctx = createExecutionContext();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { adapter: string; items: unknown[] };
      expect(body.adapter).toBe("alpha-batch-webhook");
      expect(body.items).toHaveLength(2);
      return new Response("accepted", { status: 202 });
    });

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/batch" }, ctx, {
      coordinator: coordinator(),
      fetchImpl,
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks.sort()).toEqual(["batch-message-1", "batch-message-2"]);
    expect(result.retryMessages).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("splits a batch above the item limit", () => {
    const envelopes = Array.from({ length: 51 }, (_, index) => toQueueEnvelope({ ...event(), event_id: `batch-event-${index}` }, "alpha-batch-webhook"));
    const chunks = buildPushChunks(envelopes, true);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].message.items).toHaveLength(50);
    expect(chunks[1].message.items).toHaveLength(1);
    expect(chunks[0].message.chunk).toEqual({ index: 0, total: 2 });
    expect(chunks[1].message.chunk).toEqual({ index: 1, total: 2 });
  });

  it("uses bounded exponential retry delays", () => {
    expect(queueRetryDelay(1, () => 0)).toBe(5);
    expect(queueRetryDelay(2, () => 0)).toBe(15);
    expect(queueRetryDelay(3, () => 0)).toBe(45);
    expect(queueRetryDelay(4, () => 0)).toBe(45);
  });

  it("retries a transient Queue delivery failure", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-http-webhook", [{
      id: "retry-message-1",
      timestamp: new Date(),
      attempts: 1,
      body: envelope,
    }]);
    const ctx = createExecutionContext();
    const fetchImpl = vi.fn(async () => new Response("upstream down", { status: 503 }));

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook" }, ctx, {
      coordinator: coordinator(),
      fetchImpl,
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toHaveLength(0);
    expect(result.retryMessages).toMatchObject([{ msgId: "retry-message-1" }]);
  });

  it("acks and archives a retry-exhausted Queue message", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-http-webhook", [{
      id: "dlq-message-1",
      timestamp: new Date(),
      attempts: 4,
      body: envelope,
    }]);
    const ctx = createExecutionContext();
    const archived: unknown[] = [];
    const coordinatorWithArchive: CoordinatorRpc = {
      ...coordinator(),
      archiveColdPath: async (entry) => {
        archived.push(entry);
        return { key: "coldpath:dlq:http-webhook:test" };
      },
    };
    const fetchImpl = vi.fn(async () => new Response("upstream down", { status: 503 }));

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook" }, ctx, {
      coordinator: coordinatorWithArchive,
      fetchImpl,
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["dlq-message-1"]);
    expect(result.retryMessages).toHaveLength(0);
    expect(archived).toMatchObject([{ kind: "dlq", attempts: 4, event_id: "queue-event-1" }]);
  });

  it("archives a non-retryable 4xx as drop", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-http-webhook", [{
      id: "drop-message-1",
      timestamp: new Date(),
      attempts: 1,
      body: envelope,
    }]);
    const ctx = createExecutionContext();
    const archived: unknown[] = [];
    const coordinatorWithArchive: CoordinatorRpc = {
      ...coordinator(),
      archiveColdPath: async (entry) => {
        archived.push(entry);
        return { key: "coldpath:drop:http-webhook:test" };
      },
    };

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook" }, ctx, {
      coordinator: coordinatorWithArchive,
      fetchImpl: vi.fn(async () => new Response("bad request", { status: 400 })),
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["drop-message-1"]);
    expect(archived).toMatchObject([{ kind: "drop", attempts: 1 }]);
  });

  it("exports an archived entry to KV without making KV authoritative", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-http-webhook", [{
      id: "kv-message-1",
      timestamp: new Date(),
      attempts: 4,
      body: envelope,
    }]);
    const ctx = createExecutionContext();
    const put = vi.fn(async () => undefined);
    const kv = { put } as unknown as KVNamespace;
    const coordinatorWithArchive: CoordinatorRpc = {
      ...coordinator(),
      archiveColdPath: async () => ({ key: "coldpath:dlq:http-webhook:kv" }),
    };

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook", COLD_PATH_KV: kv }, ctx, {
      coordinator: coordinatorWithArchive,
      fetchImpl: vi.fn(async () => new Response("upstream down", { status: 503 })),
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["kv-message-1"]);
    expect(put).toHaveBeenCalledWith("coldpath:dlq:http-webhook:kv", expect.any(String), { expirationTtl: 7 * 24 * 60 * 60 });
  });

  it("keeps an archived DO record when KV export fails", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-http-webhook", [{
      id: "kv-failure-message-1",
      timestamp: new Date(),
      attempts: 4,
      body: envelope,
    }]);
    const ctx = createExecutionContext();
    const kv = { put: vi.fn(async () => { throw new Error("KV unavailable"); }) } as unknown as KVNamespace;
    const archive = vi.fn(async () => ({ key: "coldpath:dlq:http-webhook:kv-failure" }));
    const coordinatorWithArchive: CoordinatorRpc = { ...coordinator(), archiveColdPath: archive };

    await processQueueBatch(batch, { PHASE1_WEBHOOK_URL: "https://channel.invalid/hook", COLD_PATH_KV: kv }, ctx, {
      coordinator: coordinatorWithArchive,
      fetchImpl: vi.fn(async () => new Response("upstream down", { status: 503 })),
    });
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toEqual(["kv-failure-message-1"]);
    expect(archive).toHaveBeenCalledTimes(1);
  });

  it("consumes a Queue message, sends it, and explicitly acks it", async () => {
    const envelope = toQueueEnvelope(event(), "http-webhook");
    const batch = createMessageBatch<QueueEnvelope>("universal-cf-gateway-alpha-http-webhook", [{
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
