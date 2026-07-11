import { JsonWebhookAdapter } from "./adapters";
import { genericJsonDecoder } from "./decoder";
import { materializeHttp } from "./io";
import { router } from "./router";
import type { InternalEvent, InternalPushMessage, RequestMeta } from "./types";

export * from "./adapters";
export * from "./decoder";
export * from "./io";
export * from "./router";
export * from "./schema";
export * from "./types";

const phase0Adapter = new JsonWebhookAdapter("slack-webhook");

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
      severity: event.severity,
      timestamp: event.timestamp,
      trace: event.trace,
    }],
    chunk: { index: 0, total: 1 },
    attempt: 0,
    created_at: event.timestamp,
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

    const sourceId = sourceFromRequest(request);
    if (!sourceId) return jsonResponse({ error: "SOURCE_REQUIRED" }, 400);

    const receivedAt = new Date().toISOString();
    const rawInput = await materializeHttp(request);
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

    const targetAdapter = route.adapter_ids[0];
    const rendered = await phase0Adapter.render(toPushMessage(decoded, targetAdapter), {
      secrets: { endpoint: "https://phase0.invalid/transport" },
      config: phase0Adapter.config,
    });

    return jsonResponse({
      event: decoded,
      route,
      rendered: { transport: rendered.transport },
    });
  },
};
