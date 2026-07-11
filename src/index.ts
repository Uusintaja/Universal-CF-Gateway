/**
 * Universal CF Gateway - Phase 0: Input I/O + Decoder + Router + render
 * Per DESIGN-DOC Phase 0 acceptance: POST webhook -> see InternalEvent + TransportRequest log
 * No transmit yet (Phase 1)
 */

import { materializeHttp } from './io/input.js';
import { getDecoder } from './decoder/registry.js';
import { createRouter } from './router/router.js';
import { ADAPTER_REGISTRY } from './adapter/email.js';
import type { RequestMeta } from './decoder/types.js';

function extractSourceId(req: Request): string | null {
  const url = new URL(req.url);
  // 1. path /webhook/:source_id or /:source_id or /source/:source_id
  const m = url.pathname.match(/\/webhook\/([^\/\?]+)/) ?? url.pathname.match(/^\/([^\/\?]+)/);
  if (m && m[1] && m[1] !== 'favicon.ico') {
    return decodeURIComponent(m[1]);
  }
  // 2. header X-Gateway-Source (SELECTOR per §2.2)
  const h = req.headers.get('X-Gateway-Source') ?? req.headers.get('x-gateway-source');
  if (h) return h;
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(req: Request, env: any, ctx: any): Promise<Response> {
    // DESIGN-DOC §2.1: Rate Limiting should be first line (Phase 4). Placeholder for Phase 0.
    // if (env.SOURCE_LIMITER) { const {success}=await env.SOURCE_LIMITER.limit({key: sourceId}); if(!success) return 429 }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed, use POST', code: 'METHOD_NOT_ALLOWED' }, 405);
    }

    const sourceId = extractSourceId(req);
    if (!sourceId) {
      return jsonResponse({ error: 'Missing source_id', code: 'BAD_REQUEST', hint: 'Use /webhook/:source_id or X-Gateway-Source header' }, 400);
    }

    // Registry check per §2.2: if no decoder for sourceId, still allow generic per Phase 0, but log
    // Real Phase will return 404 if registry has no entry. For MVP we fallback to generic.
    let raw;
    try {
      raw = await materializeHttp(req);
    } catch (e: any) {
      const status = e?.status ?? 400;
      const kind = e?.kind ?? 'materialize_error';
      return jsonResponse({ error: e?.message ?? 'Materialize failed', code: kind, status }, status);
    }

    const meta: RequestMeta = {
      source_id: sourceId,
      auth_context: null, // Auth Layer placeholder §2.5 - mechanism out of scope
      received_at: new Date().toISOString(),
      transport: 'http',
      trace_id: raw.trace_id
    };

    const decoder = getDecoder(sourceId);
    const decoded = await decoder.decode(raw, meta);

    if ((decoded as any).code) {
      // DecodeError
      const err = decoded as any;
      return jsonResponse({ error: err.message, code: err.code, trace: raw.trace_id }, err.http_status ?? 400);
    }

    const internalEvent = decoded as any;

    // Router
    const router = createRouter();
    const routeResult = router.route(internalEvent);

    if (!routeResult) {
      // Unmatched -> default email + archive unmatched per §5.6 (sampling)
      return jsonResponse(
        {
          message: 'No route matched - fallback to default + unmatched archive (Phase 4 sampling)',
          event: internalEvent,
          fallback: { adapter_ids: ['email-mailchannels'], dispatch: 'enqueue' },
          trace: raw.trace_id
        },
        202
      );
    }

    // Render only (Phase 0 - no transmit) per Implementation Plan
    const rendered: any[] = [];
    for (const adapterId of routeResult.adapter_ids) {
      const adapter = (ADAPTER_REGISTRY as any)[adapterId] ?? Object.values(ADAPTER_REGISTRY)[0];
      if (!adapter) continue;

      // Build InternalPushMessage per §3 (single item for Phase 0)
      const pushMsg = {
        schema_version: '1.0' as const,
        message_id: crypto.randomUUID(),
        target_adapter: adapterId,
        severity: internalEvent.severity,
        items: [
          {
            event_id: internalEvent.event_id,
            title: internalEvent.title,
            body: internalEvent.body,
            severity: internalEvent.severity,
            timestamp: internalEvent.timestamp,
            trace: internalEvent.trace
          }
        ],
        chunk: { index: 0, total: 1 },
        attempt: 0,
        created_at: new Date().toISOString()
      };

      try {
        const tr = await adapter.render(pushMsg as any, {
          secrets: {
            EMAIL_FROM: (env as any)?.EMAIL_FROM ?? 'gateway@example.com',
            EMAIL_TO: (env as any)?.EMAIL_TO ?? 'test@example.com'
          },
          config: adapter.config
        });
        rendered.push({ adapter: adapterId, transportRequest: tr });
      } catch (e: any) {
        rendered.push({ adapter: adapterId, error: e?.message ?? String(e) });
      }
    }

    // Structured log per Observability v1 minimal
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'phase0_render',
        source_id: sourceId,
        event_id: internalEvent.event_id,
        trace_id: raw.trace_id,
        route: routeResult,
        rendered_count: rendered.length
      })
    );

    // Phase 0 acceptance: return InternalEvent + TransportRequest
    return jsonResponse(
      {
        message: 'Phase 0 OK - decode + route + render (no transmit)',
        event: internalEvent,
        route: routeResult,
        rendered,
        trace: raw.trace_id
      },
      200
    );
  }
};

export class CoordinatorDO {
  // Minimal shell for Miniflare binding, real logic Phase 2
  constructor(_state: DurableObjectState) {}
  async fetch(): Promise<Response> {
    return new Response('CoordinatorDO placeholder Phase 0', { status: 200 });
  }
}
