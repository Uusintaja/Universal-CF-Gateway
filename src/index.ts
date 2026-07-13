import { AlphaBatchWebhookAdapter, JsonWebhookAdapter } from "./adapters";
import { genericJsonDecoder } from "./decoder";
import { materializeHttp } from "./io";
import { OUTPUT_IO_LIMITS, transmitHttp, type TransmitHttpOptions, type TransmitHttpResult } from "./output-io";
import { buildPushChunks, toQueueEnvelope } from "./queue";
import { router } from "./router";
import type { ChannelAdapter, ColdPathEntry, CoordinatorRpc, Env, InternalEvent, InternalPushMessage, QueueEnvelope, RequestMeta } from "./types";

export { CoordinatorDO } from "./coordinator";
export * from "./adapters";
export * from "./decoder";
export * from "./event-id";
export * from "./io";
export * from "./output-io";
export * from "./queue";
export * from "./router";
export * from "./schema";
export * from "./types";

const phase1Adapter = new JsonWebhookAdapter("http-webhook");
const alphaBatchAdapter = new AlphaBatchWebhookAdapter();
const adapters = new Map<string, ChannelAdapter>([
  [phase1Adapter.id, phase1Adapter],
  [alphaBatchAdapter.id, alphaBatchAdapter],
]);

export interface WorkerDependencies extends Pick<TransmitHttpOptions, "fetchImpl" | "sleep"> {
  coordinator?: CoordinatorRpc;
  timeoutMs?: number;
  immediateRetries?: number;
  backoffMs?: number;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sourceFromRequest(request: Request): string | null {
  const headerSource = request.headers.get("x-gateway-source");
  if (headerSource?.trim()) return headerSource.trim();

  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[0] === "hooks" && segments[1] ? segments[1] : null;
}

function toPushMessage(event: InternalEvent, adapterId: string): InternalPushMessage {
  return {
    schema_version: "1.0",
    message_id: event.event_id,
    target_adapter: adapterId,
    severity: event.severity,
    items: [{
      event_id: event.event_id,
      title: event.title,
      body: event.body,
      raw_payload: event.raw_payload,
      severity: event.severity,
      timestamp: event.timestamp,
      trace: event.trace,
    }],
    chunk: { index: 0, total: 1 },
    attempt: 0,
    created_at: event.timestamp,
  };
}

function failureStatus(result: Extract<Awaited<ReturnType<typeof transmitHttp>>, { ok: false }>): number {
  if (result.error.code === "NETWORK") return 504;
  if (result.status === 429 || result.status !== undefined && result.status >= 500) return 502;
  return 400;
}

function coordinatorFor(env: Env, dependencies: WorkerDependencies, adapterId: string): CoordinatorRpc | null {
  if (dependencies.coordinator) return dependencies.coordinator;
  if (!env.COORDINATOR) return null;
  return env.COORDINATOR.get(env.COORDINATOR.idFromName(adapterId)) as unknown as CoordinatorRpc;
}

function adapterFor(adapterId: string): ChannelAdapter | null {
  return adapters.get(adapterId) ?? null;
}

function queueFor(env: Env, adapterId: string): Queue<QueueEnvelope> | null {
  if (adapterId === phase1Adapter.id) return env.HTTP_WEBHOOK_QUEUE ?? null;
  if (adapterId === alphaBatchAdapter.id) return env.ALPHA_BATCH_WEBHOOK_QUEUE ?? null;
  return null;
}

export async function handleRequest(
  request: Request,
  env: Env,
  dependencies: WorkerDependencies = {},
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

  const sourceId = sourceFromRequest(request);
  if (!sourceId) return jsonResponse({ error: "SOURCE_REQUIRED" }, 400);

  const receivedAt = new Date().toISOString();
  let rawInput;
  try {
    rawInput = await materializeHttp(request);
  } catch (error) {
    if (error instanceof Error && "httpStatus" in error) {
      const inputError = error as Error & { code: string; httpStatus: number };
      return jsonResponse({ error: inputError.code, message: inputError.message }, inputError.httpStatus);
    }
    return jsonResponse({ error: "INPUT_READ_FAILED" }, 400);
  }

  const meta: RequestMeta = {
    source_id: sourceId,
    auth_context: null,
    received_at: receivedAt,
    transport: "http",
  };
  const decoded = await genericJsonDecoder.decode(rawInput, meta);

  if ("code" in decoded) {
    return jsonResponse({ error: decoded.code, message: decoded.message }, decoded.http_status ?? 400);
  }

  const route = router.route(decoded);
  if (!route) return jsonResponse({ event: decoded, route: null }, 200);

  if (route.dispatch === "enqueue") {
    const adapterId = route.adapter_ids.length === 1 ? route.adapter_ids[0] : undefined;
    const adapter = adapterId ? adapterFor(adapterId) : null;
    const queue = adapterId ? queueFor(env, adapterId) : null;
    if (!adapter || !queue) {
      return jsonResponse({ error: adapter ? "QUEUE_NOT_CONFIGURED" : "ADAPTER_NOT_IMPLEMENTED", route }, 503);
    }
    await queue.send(toQueueEnvelope(decoded, adapter.id), { contentType: "json" });
    return jsonResponse({ status: "queued", event_id: decoded.event_id, route }, 202);
  }

  if (route.adapter_ids.length !== 1 || route.adapter_ids[0] !== phase1Adapter.id) {
    return jsonResponse({ error: "ADAPTER_NOT_IMPLEMENTED", route }, 501);
  }
  if (!env.PHASE1_WEBHOOK_URL) {
    return jsonResponse({ error: "CONFIGURATION_ERROR", message: "PHASE1_WEBHOOK_URL is not configured" }, 503);
  }

  const coordinator = coordinatorFor(env, dependencies, phase1Adapter.id);
  if (!coordinator) {
    return jsonResponse({ error: "COORDINATOR_NOT_CONFIGURED" }, 503);
  }

  const acquired = await coordinator.acquire({
    event_ids: [decoded.event_id],
    severity: decoded.severity,
  });
  if (!acquired.allowed) {
    return jsonResponse({ error: acquired.reason.toUpperCase(), route }, acquired.reason === "lane_full" ? 429 : 503);
  }
  if (!acquired.lease_id || acquired.to_send_ids.length === 0) {
    return jsonResponse({
      status: "deduplicated",
      attempts: 0,
      event_id: decoded.event_id,
      route,
    });
  }

  let result: TransmitHttpResult | undefined;
  try {
    const rendered = await phase1Adapter.render(toPushMessage(decoded, phase1Adapter.id), {
      secrets: { endpoint: env.PHASE1_WEBHOOK_URL },
      config: phase1Adapter.config,
    });
    result = await transmitHttp(rendered, {
      fetchImpl: dependencies.fetchImpl,
      sleep: dependencies.sleep,
      timeoutMs: dependencies.timeoutMs ?? OUTPUT_IO_LIMITS.TIMEOUT_MS,
      immediateRetries: dependencies.immediateRetries ?? OUTPUT_IO_LIMITS.IMMEDIATE_RETRIES,
      backoffMs: dependencies.backoffMs ?? OUTPUT_IO_LIMITS.BACKOFF_MS,
    });
  } catch (error) {
    result = {
      ok: false,
      attempts: 1,
      error: {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : "Phase 1 transmit failed",
        retryable: false,
      },
    };
  } finally {
    await coordinator.release({ lease_id: acquired.lease_id, success: result?.ok === true });
  }

  console.log(JSON.stringify({
    level: result.ok ? "info" : "warn",
    event: "transmit_result",
    adapter: phase1Adapter.id,
    success: result.ok,
    attempts: result.attempts,
    status: result.ok ? result.status : result.status,
    trace_id: decoded.trace.gateway_trace,
  }));

  if (!result.ok) {
    return jsonResponse({
      error: result.error.code,
      message: result.error.message,
      attempts: result.attempts,
    }, failureStatus(result));
  }

  return jsonResponse({
    status: "sent",
    attempts: result.attempts,
    upstream_status: result.status,
    event_id: decoded.event_id,
    route,
  });
}

export const QUEUE_MAX_ATTEMPTS = 4;

export function queueRetryDelay(attempts: number, random = Math.random): number {
  const exponent = Math.max(0, attempts - 1);
  const base = Math.min(5 * 3 ** exponent, 45);
  return base + Math.floor(random() * 3);
}

function coldPathEntry(envelope: QueueEnvelope, kind: ColdPathEntry["kind"], reason: string, attempts: number): ColdPathEntry {
  return {
    kind,
    adapter: envelope.adapter_id,
    reason,
    attempts,
    event_id: envelope.event_id,
    source_id: envelope.source_id,
    payload: envelope.body,
    raw_payload: envelope.raw_payload,
    trace: envelope.trace,
    received_at: new Date().toISOString(),
  };
}

async function archiveAndExport(entry: ColdPathEntry, coordinator: CoordinatorRpc, env: Env): Promise<void> {
  const archived = await coordinator.archiveColdPath(entry);
  console.log(JSON.stringify({
    level: "info",
    event: "coldpath_archived",
    key: archived.key,
    kind: entry.kind,
    adapter: entry.adapter,
    event_id: entry.event_id,
    kv_export: env.COLD_PATH_KV ? "scheduled" : "unavailable",
  }));
  if (!env.COLD_PATH_KV) return;
  try {
    await env.COLD_PATH_KV.put(archived.key, JSON.stringify(entry), { expirationTtl: 7 * 24 * 60 * 60 });
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "coldpath_kv_export_failed",
      key: archived.key,
      error: error instanceof Error ? error.message : "KV export failed",
    }));
  }
}

function retryMessages(messages: Message<QueueEnvelope>[], attempts: number): void {
  const delaySeconds = queueRetryDelay(attempts);
  messages.forEach((message) => message.retry({ delaySeconds }));
}

function ackAndArchive(
  messages: Message<QueueEnvelope>[],
  entries: QueueEnvelope[],
  kind: ColdPathEntry["kind"],
  reason: string,
  ctx: ExecutionContext,
  coordinator: CoordinatorRpc,
  env: Env,
): void {
  messages.forEach((message) => message.ack());
  ctx.waitUntil(Promise.all(entries.map((envelope) => archiveAndExport(
    coldPathEntry(envelope, kind, reason, messages.find((message) => message.body.event_id === envelope.event_id)?.attempts ?? 1),
    coordinator,
    env,
  ))));
}

export async function processQueueBatch(
  batch: MessageBatch<QueueEnvelope>,
  env: Env,
  ctx: ExecutionContext,
  dependencies: WorkerDependencies = {},
): Promise<void> {
  let sent = 0;
  let deduplicated = 0;
  let retried = 0;
  let archived = 0;
  const grouped = new Map<string, Array<{ message: Message<QueueEnvelope>; envelope: QueueEnvelope }>>();

  for (const message of batch.messages) {
    const group = grouped.get(message.body.adapter_id) ?? [];
    group.push({ message, envelope: message.body });
    grouped.set(message.body.adapter_id, group);
  }

  for (const [adapterId, entries] of grouped) {
    const adapter = adapterFor(adapterId);
    const coordinator = coordinatorFor(env, dependencies, adapterId);
    if (!adapter || !coordinator || !env.PHASE1_WEBHOOK_URL) {
      entries.forEach(({ message }) => message.retry({ delaySeconds: queueRetryDelay(message.attempts) }));
      retried += entries.length;
      continue;
    }

    const envelopes = entries.map((entry) => entry.envelope);
    const chunks = buildPushChunks(envelopes, adapter.supportsBatch === true);
    const messagesByEventId = new Map(entries.map((entry) => [entry.envelope.event_id, entry.message]));

    for (const chunk of chunks) {
      const sourceMessages = chunk.envelopes
        .map((envelope) => messagesByEventId.get(envelope.event_id))
        .filter((message): message is Message<QueueEnvelope> => message !== undefined);
      const maxAttempts = Math.max(...sourceMessages.map((message) => message.attempts), 1);
      const acquired = await coordinator.acquire({
        event_ids: chunk.envelopes.map((envelope) => envelope.event_id),
        severity: chunk.message.severity,
      });

      if (!acquired.allowed) {
        if (maxAttempts >= QUEUE_MAX_ATTEMPTS) {
          ackAndArchive(sourceMessages, chunk.envelopes, "dlq", acquired.reason, ctx, coordinator, env);
          archived += sourceMessages.length;
        } else {
          retryMessages(sourceMessages, maxAttempts);
          retried += sourceMessages.length;
        }
        continue;
      }
      if (!acquired.lease_id || acquired.to_send_ids.length === 0) {
        sourceMessages.forEach((message) => message.ack());
        deduplicated += sourceMessages.length;
        continue;
      }

      const toSend = new Set(acquired.to_send_ids);
      const messageToSend: InternalPushMessage = {
        ...chunk.message,
        items: chunk.message.items.filter((item) => toSend.has(item.event_id)),
      };
      let result: TransmitHttpResult | undefined;
      try {
        const rendered = adapter.supportsBatch && adapter.renderBatch
          ? await adapter.renderBatch(messageToSend, { secrets: { endpoint: env.PHASE1_WEBHOOK_URL }, config: adapter.config })
          : await adapter.render(messageToSend, { secrets: { endpoint: env.PHASE1_WEBHOOK_URL }, config: adapter.config });
        if (rendered.transport !== "http") throw new Error("Queue Adapter must use HTTP transport");
        // Queue retries are the outer retry mechanism; avoid multiplying retries here.
        result = await transmitHttp(rendered, {
          fetchImpl: dependencies.fetchImpl,
          sleep: dependencies.sleep,
          timeoutMs: dependencies.timeoutMs ?? OUTPUT_IO_LIMITS.TIMEOUT_MS,
          immediateRetries: 0,
          backoffMs: 0,
        });
      } catch (error) {
        result = {
          ok: false,
          attempts: 1,
          error: { code: "INVALID_MESSAGE", message: error instanceof Error ? error.message : "Queue Adapter failed", retryable: false },
        };
      } finally {
        await coordinator.release({ lease_id: acquired.lease_id, success: result?.ok === true });
      }

      if (result.ok) {
        sourceMessages.forEach((message) => message.ack());
        sent += sourceMessages.length;
        continue;
      }

      const reason = result.error.message;
      if (result.error.retryable && maxAttempts < QUEUE_MAX_ATTEMPTS) {
        retryMessages(sourceMessages, maxAttempts);
        retried += sourceMessages.length;
      } else {
        const kind = result.error.retryable ? "dlq" : "drop";
        ackAndArchive(sourceMessages, chunk.envelopes, kind, reason, ctx, coordinator, env);
        archived += sourceMessages.length;
      }
    }
  }

  console.log(JSON.stringify({
    level: "info",
    event: "queue_batch_result",
    queue: batch.queue,
    batch_size: batch.messages.length,
    sent,
    deduplicated,
    retried,
    archived,
  }));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  queue(batch: MessageBatch<QueueEnvelope>, env: Env, ctx: ExecutionContext): Promise<void> {
    return processQueueBatch(batch, env, ctx);
  },
};
