import { JsonWebhookAdapter } from "./adapters";
import { genericJsonDecoder } from "./decoder";
import { materializeHttp } from "./io";
import { OUTPUT_IO_LIMITS, transmitHttp, type TransmitHttpOptions, type TransmitHttpResult } from "./output-io";
import { pushMessageFromEnvelope, toQueueEnvelope } from "./queue";
import { router } from "./router";
import type { CoordinatorRpc, Env, InternalEvent, InternalPushMessage, QueueEnvelope, RequestMeta } from "./types";

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
    if (route.adapter_ids.length !== 1 || route.adapter_ids[0] !== phase1Adapter.id) {
      return jsonResponse({ error: "ADAPTER_NOT_IMPLEMENTED", route }, 501);
    }
    if (!env.HTTP_WEBHOOK_QUEUE) {
      return jsonResponse({ error: "QUEUE_NOT_CONFIGURED" }, 503);
    }
    await env.HTTP_WEBHOOK_QUEUE.send(toQueueEnvelope(decoded, phase1Adapter.id), { contentType: "json" });
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

export async function processQueueBatch(
  batch: MessageBatch<QueueEnvelope>,
  env: Env,
  _ctx: ExecutionContext,
  dependencies: WorkerDependencies = {},
): Promise<void> {
  let sent = 0;
  let deduplicated = 0;
  let retried = 0;

  for (const message of batch.messages) {
    const envelope = message.body;
    if (envelope.adapter_id !== phase1Adapter.id) {
      message.retry({ delaySeconds: 5 });
      retried += 1;
      continue;
    }
    if (!env.PHASE1_WEBHOOK_URL) {
      message.retry({ delaySeconds: 5 });
      retried += 1;
      continue;
    }

    const coordinator = coordinatorFor(env, dependencies, envelope.adapter_id);
    if (!coordinator) {
      message.retry({ delaySeconds: 5 });
      retried += 1;
      continue;
    }

    const acquired = await coordinator.acquire({
      event_ids: [envelope.event_id],
      severity: envelope.severity,
    });
    if (!acquired.allowed) {
      message.retry({ delaySeconds: 5 });
      retried += 1;
      continue;
    }
    if (!acquired.lease_id || acquired.to_send_ids.length === 0) {
      message.ack();
      deduplicated += 1;
      continue;
    }

    let result: TransmitHttpResult | undefined;
    try {
      const rendered = await phase1Adapter.render(pushMessageFromEnvelope(envelope), {
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
    } catch {
      result = {
        ok: false,
        attempts: 1,
        error: { code: "UNKNOWN", message: "Queue message transmit failed", retryable: true },
      };
    } finally {
      await coordinator.release({ lease_id: acquired.lease_id, success: result?.ok === true });
    }

    if (result.ok) {
      message.ack();
      sent += 1;
    } else {
      message.retry({ delaySeconds: 5 });
      retried += 1;
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
