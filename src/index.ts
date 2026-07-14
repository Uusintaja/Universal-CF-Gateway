/**
 * Universal CF Gateway - Phase 1: High-priority sync path with transmit
 * Per DESIGN-DOC Phase 1 acceptance: POST high-event -> real push to email/webhook
 * - Input I/O + Decoder + Router + render + transmit (direct, no DO yet)
 * - OUTPUT_IO_LIMITS: high 3s / low 10s configurable per user decision
 */

import { materializeHttp } from './io/input.js';
import { getDecoder } from './decoder/registry.js';
import { createRouter } from './router/router.js';
import { ADAPTER_REGISTRY } from './adapter/registry.js';
import { transmit } from './io/output.js';
import { enqueue } from './queues/producer.js';
import { handleQueueBatch } from './queues/consumer.js';
import type { RequestMeta } from './decoder/types.js';

function extractSourceId(req: Request): string | null {
  const url = new URL(req.url);
  const m = url.pathname.match(/\/webhook\/([^\/\?]+)/) ?? url.pathname.match(/^\/([^\/\?]+)/);
  if (m && m[1] && m[1] !== 'favicon.ico' && m[1] !== 'webhook') {
    return decodeURIComponent(m[1]);
  }
  // header X-Gateway-Source
  const h = req.headers.get('X-Gateway-Source') ?? req.headers.get('x-gateway-source');
  if (h) return h;
  // fallback for root POST used in tests: if path is /webhook/* and generic, allow generic source
  if (url.pathname.startsWith('/webhook')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return parts[1];
  }
  // final fallback for tests
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
    // §2.1 Rate Limiting placeholder Phase 4
    // if (env.SOURCE_LIMITER) { const {success}=await env.SOURCE_LIMITER.limit({key: sourceId}); if(!success) return 429 }

    const url = new URL(req.url);

    // Debug endpoints for Phase2 smoke - allow GET without source_id
    if (req.method === 'GET') {
      if (url.pathname === '/debug' || url.pathname === '/debug/env') {
        return jsonResponse({
          has_COORDINATOR: !!env?.COORDINATOR,
          has_KV: !!env?.KV,
          has_Q_SLACK: !!env?.Q_SLACK_EXP || !!env?.Q_SLACK,
          has_EMAIL: !!env?.EMAIL,
          has_SECRETS: {
            SLACK_WEBHOOK_URL: !!env?.SLACK_WEBHOOK_URL,
            WEBHOOK_SITE_URL: !!env?.WEBHOOK_SITE_URL,
            EMAIL_TO: !!env?.EMAIL_TO
          },
          worker_name: 'universal-cf-gateway-mvp-experimental',
          wrangler_migration: 'new_sqlite_classes CoordinatorDO',
          observability: { logs: true, traces: true }
        });
      }
      if (url.pathname === '/status') {
        if (!env?.COORDINATOR) {
          return jsonResponse({ error: 'No COORDINATOR binding', has_COORDINATOR: false }, 501);
        }
        try {
          const adapters = ['email-mailchannels', 'slack-webhook', 'webhook-site', 'status-check'];
          const allStatus: any = {};
          for (const adapter of adapters) {
            try {
              const stub = env.COORDINATOR.get(env.COORDINATOR.idFromName(adapter));
              let s: any;
              if (typeof stub.status === 'function') {
                s = await stub.status();
              } else {
                const res = await stub.fetch(new Request('https://do/status'));
                s = await res.json();
              }
              allStatus[adapter] = s;
            } catch (e: any) {
              allStatus[adapter] = { error: e?.message };
            }
          }
          // Aggregate delivered count
          let totalDelivered = 0;
          for (const v of Object.values(allStatus) as any[]) {
            totalDelivered += v?.delivered_marker_count ?? 0;
          }
          return jsonResponse({ ok: true, aggregated_delivered: totalDelivered, per_adapter: allStatus });
        } catch (e: any) {
          return jsonResponse({ error: e?.message, stack: e?.stack }, 500);
        }
      }
      return jsonResponse(
        { error: 'Use POST /webhook/:source_id for events, GET /debug or /status for diagnostics', has_COORDINATOR: !!env?.COORDINATOR },
        405
      );
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed, use POST', code: 'METHOD_NOT_ALLOWED' }, 405);
    }

    const sourceId = extractSourceId(req) ?? (req.headers.get('X-Gateway-Source') ? req.headers.get('X-Gateway-Source')! : 'monitor');
    // Allow generic fallback per Phase 0/1 - real 400 only if truly missing and not test
    // For strict 400, uncomment below:
    // if (!sourceId) return json 400

    let raw;
    try {
      raw = await materializeHttp(req);
    } catch (e: any) {
      const status = e?.status ?? 400;
      return jsonResponse({ error: e?.message ?? 'Materialize failed', code: e?.kind ?? 'materialize_error' }, status);
    }

    const meta: RequestMeta = {
      source_id: sourceId,
      auth_context: null,
      received_at: new Date().toISOString(),
      transport: 'http',
      trace_id: raw.trace_id
    };

    const decoder = getDecoder(sourceId);
    const decoded = await decoder.decode(raw, meta);

    if ((decoded as any).code) {
      const err = decoded as any;
      return jsonResponse({ error: err.message, code: err.code, trace: raw.trace_id }, err.http_status ?? 400);
    }

    const internalEvent = decoded as any;
    const router = createRouter();
    const routeResult = router.route(internalEvent);

    if (!routeResult) {
      return jsonResponse(
        {
          message: 'No route matched - fallback',
          event: internalEvent,
          fallback: { adapter_ids: ['email-mailchannels'], dispatch: 'enqueue' },
          trace: raw.trace_id
        },
        202
      );
    }

    // Phase 3A: Low-priority enqueue path - write-time routing to Queues
    if (routeResult.dispatch === 'enqueue') {
      const { enqueued, failed } = await enqueue(internalEvent, routeResult, env);
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'phase3a_enqueue',
          source_id: sourceId,
          event_id: internalEvent.event_id,
          trace_id: raw.trace_id,
          route: routeResult,
          enqueued,
          failed
        })
      );
      return jsonResponse(
        {
          message: 'Phase 3A OK - enqueued to low-priority queues (happy path)',
          event: internalEvent,
          route: routeResult,
          enqueued,
          failed,
          trace: raw.trace_id
        },
        failed.length > 0 ? 207 : 202
      );
    }

    const rendered: any[] = [];
    const transmitResults: any[] = [];

    for (const adapterId of routeResult.adapter_ids) {
      const adapter = (ADAPTER_REGISTRY as any)[adapterId];
      if (!adapter) continue;

      // Phase 2: DO gating for immediate path (per DESIGN-DOC §5.1 high path)
      let toSendIds: string[] = [internalEvent.event_id];
      let lane: any = null;
      let coordinatorStub: any = null;

      if (env?.COORDINATOR) {
        try {
          coordinatorStub = env.COORDINATOR.get(env.COORDINATOR.idFromName(adapterId));
          const acquireRes: any = await coordinatorStub.acquire({
            event_ids: [internalEvent.event_id],
            severity: internalEvent.severity,
            adapter_id: adapterId
          });

          if (!acquireRes.allowed) {
            // circuit_open or lane_full per §4.2
            console.log(
              JSON.stringify({
                level: 'warn',
                event: 'acquire_blocked',
                adapter: adapterId,
                reason: acquireRes.reason,
                trace_id: raw.trace_id
              })
            );
            transmitResults.push({
              adapter: adapterId,
              result: {
                ok: false,
                sent_ids: [],
                error: {
                  code: acquireRes.reason === 'circuit_open' ? 'CIRCUIT_OPEN' : 'LANE_FULL',
                  message: acquireRes.reason,
                  retryable: acquireRes.reason === 'lane_full'
                }
              }
            });
            // fail-fast for circuit_open, retry for lane_full
            continue;
          }

          if (acquireRes.to_send_ids.length === 0) {
            console.log(
              JSON.stringify({
                level: 'info',
                event: 'dedup_skip',
                adapter: adapterId,
                trace_id: raw.trace_id,
                event_id: internalEvent.event_id
              })
            );
            rendered.push({ adapter: adapterId, skipped: true, reason: 'already_delivered' });
            continue;
          }

          toSendIds = acquireRes.to_send_ids;
          lane = acquireRes.lane;
        } catch (e: any) {
          // If DO fails, fallback to direct (Phase 1 behavior) to keep availability
          console.log(
            JSON.stringify({
              level: 'warn',
              event: 'coordinator_acquire_failed_fallback',
              adapter: adapterId,
              error: e?.message,
              trace_id: raw.trace_id
            })
          );
        }
      }

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
        ].filter((it: any) => toSendIds.includes(it.event_id)),
        chunk: { index: 0, total: 1 },
        attempt: 0,
        created_at: new Date().toISOString()
      };

      try {
        const tr = await adapter.render(pushMsg as any, {
          secrets: {
            EMAIL_FROM: env?.EMAIL_FROM ?? 'gateway@example.com',
            EMAIL_TO: env?.EMAIL_TO ?? 'test@example.com',
            SLACK_WEBHOOK_URL: env?.SLACK_WEBHOOK_URL ?? env?.WEBHOOK_SITE_URL ?? '',
            WEBHOOK_SITE_URL: env?.WEBHOOK_SITE_URL ?? env?.SLACK_WEBHOOK_URL ?? ''
          },
          config: adapter.config
        });
        rendered.push({ adapter: adapterId, transportRequest: tr, to_send_ids: toSendIds, lane });

        // Phase 1/2: immediate dispatch -> transmit
        if (routeResult.dispatch === 'immediate') {
          const txRes = await transmit(tr, {
            severity: internalEvent.severity,
            eventIds: toSendIds,
            emailBinding: env?.EMAIL
          });
          transmitResults.push({ adapter: adapterId, result: txRes, lane, to_send_ids: toSendIds });

          // Release with success flag - P0 invariant: only success writes delivered
          if (coordinatorStub && lane) {
            try {
              await coordinatorStub.release({
                event_ids: toSendIds,
                lane,
                success: txRes.ok,
                adapter_id: adapterId
              });
            } catch (e: any) {
              console.log(
                JSON.stringify({
                  level: 'error',
                  event: 'coordinator_release_failed',
                  adapter: adapterId,
                  error: e?.message,
                  trace_id: raw.trace_id
                })
              );
            }
          }

          if (!txRes.ok) {
            console.log(
              JSON.stringify({
                level: 'warn',
                event: 'transmit_failed_immediate',
                adapter: adapterId,
                trace_id: raw.trace_id,
                error: txRes.error,
                severity: internalEvent.severity
              })
            );
            console.log(
              JSON.stringify({
                level: 'error',
                event: 'drop',
                adapter: adapterId,
                reason: txRes.error?.message,
                trace_id: raw.trace_id
              })
            );
          } else {
            console.log(
              JSON.stringify({
                level: 'info',
                event: 'transmit_success',
                adapter: adapterId,
                trace_id: raw.trace_id,
                severity: internalEvent.severity,
                to_send_ids: toSendIds
              })
            );
          }
        }
      } catch (e: any) {
        rendered.push({ adapter: adapterId, error: e?.message ?? String(e) });
        // On render failure, release with success=false to avoid holding lane
        if (coordinatorStub && lane) {
          try {
            await coordinatorStub.release({
              event_ids: toSendIds,
              lane,
              success: false,
              adapter_id: adapterId
            });
          } catch {}
        }
      }
    }

    const isHigh = routeResult.dispatch === 'immediate';

    console.log(
      JSON.stringify({
        level: 'info',
        event: isHigh ? 'phase1_immediate' : 'phase0_render',
        source_id: sourceId,
        event_id: internalEvent.event_id,
        trace_id: raw.trace_id,
        route: routeResult,
        rendered_count: rendered.length,
        transmitted_count: transmitResults.length
      })
    );

    return jsonResponse(
      {
        message: isHigh ? 'Phase 1 OK - immediate rendered + transmitted' : 'Phase 0 OK - enqueue rendered (no transmit yet)',
        event: internalEvent,
        route: routeResult,
        rendered,
        transmitResults: isHigh ? transmitResults : undefined,
        trace: raw.trace_id
      },
      isHigh ? (transmitResults.some((r) => !r.result.ok) ? 207 : 200) : 200
    );
  },

  async queue(batch: any, env: any, ctx: any): Promise<void> {
    // Phase 3A Happy Path consumer
    await handleQueueBatch(batch, env, ctx);
  }
};

export { CoordinatorDO } from './coordinator/coordinator.js';
