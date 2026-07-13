import type { QueuePayload } from './types.js';
import { chunkByDualThreshold } from './chunk.js';
import { ADAPTER_REGISTRY } from '../adapter/registry.js';
import { transmit } from '../io/output.js';

type QueueMessage<T> = {
  body: T;
  ack: () => void;
  retry: (opts?: any) => void;
  attempts: number;
};

type MessageBatch<T> = {
  queue: string;
  messages: QueueMessage<T>[];
};

const MAX_RETRIES = 3;

function backoffDelay(attempts: number, base = 5): number {
  // Exponential + jitter: base * 2^(attempts-1) + random 0-2s, capped at 60s
  const exp = base * Math.pow(2, attempts - 1);
  const jitter = Math.random() * 2;
  return Math.min(60, exp + jitter);
}

/**
 * Phase 3B: Retry + Cold Path
 * - lane_full -> retry delay 10s
 * - circuit_open -> retry delay circuitOpenSec (60s)
 * - transmit 429/5xx retryable -> retry with backoff, attempts < MAX_RETRIES
 * - non-retryable or exhausted -> ack + ctx.waitUntil(archiveColdPath DO authoritative + KV cache)
 */

export async function handleQueueBatch(
  batch: MessageBatch<QueuePayload>,
  env: any,
  ctx: any
): Promise<void> {
  if (batch.messages.length === 0) return;

  const events = batch.messages.map((m) => m.body.event);
  const firstAdapter = batch.messages[0].body.route.adapter_ids[0] ?? 'email-mailchannels';
  const isEmail = firstAdapter.includes('email');

  const pushMessages = chunkByDualThreshold(events, firstAdapter, isEmail);

  const chunkMap = new Map<any, typeof batch.messages>();
  for (const pushMsg of pushMessages) {
    const related = batch.messages.filter((qm) => pushMsg.items.some((it) => it.event_id === qm.body.event.event_id));
    chunkMap.set(pushMsg, related);
  }

  for (const pushMsg of pushMessages) {
    const adapterId = pushMsg.target_adapter;
    const adapter = (ADAPTER_REGISTRY as any)[adapterId];
    if (!adapter) continue;

    let toSendIds = pushMsg.items.map((i) => i.event_id);
    let lane: any = null;
    let coordinatorStub: any = null;

    if (env?.COORDINATOR) {
      try {
        coordinatorStub = env.COORDINATOR.get(env.COORDINATOR.idFromName(adapterId));
        const acquireRes: any = await coordinatorStub.acquire({
          event_ids: toSendIds,
          severity: pushMsg.severity,
          adapter_id: adapterId
        });
        if (!acquireRes.allowed) {
          const related = chunkMap.get(pushMsg) ?? [];
          const reason = acquireRes.reason;
          const delay = reason === 'circuit_open' ? 60 : 10;
          console.log(JSON.stringify({ level: 'warn', event: 'consumer_acquire_blocked_retry', adapter: adapterId, reason, delay }));
          related.forEach((m) => m.retry({ delaySeconds: delay }));
          continue;
        }
        if (acquireRes.to_send_ids.length === 0) {
          const related = chunkMap.get(pushMsg) ?? [];
          related.forEach((m) => m.ack());
          console.log(JSON.stringify({ level: 'info', event: 'consumer_dedup_skip', adapter: adapterId, count: related.length }));
          continue;
        }
        toSendIds = acquireRes.to_send_ids;
        lane = acquireRes.lane;
        pushMsg.items = pushMsg.items.filter((it) => toSendIds.includes(it.event_id));
      } catch (e: any) {
        console.log(JSON.stringify({ level: 'warn', event: 'consumer_acquire_failed_fallback', adapter: adapterId, error: e?.message }));
      }
    }

    try {
      const tr = await adapter.render(pushMsg as any, {
        secrets: {
          EMAIL_FROM: env?.EMAIL_FROM ?? 'gateway@example.com',
          EMAIL_TO: env?.EMAIL_TO ?? 'test@example.com',
          SLACK_WEBHOOK_URL: env?.SLACK_WEBHOOK_URL ?? '',
          WEBHOOK_SITE_URL: env?.WEBHOOK_SITE_URL ?? ''
        },
        config: adapter.config
      });

      const txRes = await transmit(tr, {
        severity: pushMsg.severity,
        eventIds: toSendIds,
        emailBinding: env?.EMAIL
      });

      if (coordinatorStub && lane) {
        await coordinatorStub.release({ event_ids: toSendIds, lane, success: txRes.ok, adapter_id: adapterId }).catch(() => {});
      }

      const related = chunkMap.get(pushMsg) ?? [];
      const firstAttempts = related[0]?.attempts ?? 1;

      if (txRes.ok) {
        related.forEach((m) => m.ack());
        console.log(JSON.stringify({ level: 'info', event: 'consumer_ack', adapter: adapterId, sent: toSendIds.length }));
      } else {
        const retryable = !!txRes.error?.retryable;
        const shouldRetry = retryable && firstAttempts < MAX_RETRIES;

        if (shouldRetry) {
          const delay = backoffDelay(firstAttempts);
          console.log(
            JSON.stringify({
              level: 'warn',
              event: 'consumer_retry',
              adapter: adapterId,
              attempts: firstAttempts,
              delay,
              error: txRes.error
            })
          );
          related.forEach((m) => m.retry({ delaySeconds: delay }));
        } else {
          // Exhausted or non-retryable -> ack + archive cold path (DO authoritative + KV cache)
          related.forEach((m) => m.ack());
          const kind = retryable ? 'dlq' : 'drop';
          const entry = {
            kind,
            adapter: adapterId,
            reason: txRes.error?.message ?? 'unknown',
            attempts: firstAttempts,
            payload: pushMsg,
            received_at: new Date().toISOString()
          };

          if (coordinatorStub) {
            ctx?.waitUntil?.(
              (async () => {
                try {
                  await coordinatorStub.archiveColdPath(entry);
                } catch (e: any) {
                  console.log(JSON.stringify({ level: 'error', event: 'archiveColdPath_failed', error: e?.message }));
                }
                // KV cache export - best effort
                if (env?.KV) {
                  try {
                    const key = `coldpath:${kind}:${adapterId}:${crypto.randomUUID()}`;
                    await env.KV.put(key, JSON.stringify(entry), { expirationTtl: 7 * 24 * 3600 });
                  } catch (e: any) {
                    console.log(JSON.stringify({ level: 'warn', event: 'coldpath_kv_fail', kind, error: e?.message }));
                  }
                }
              })()
            );
          } else {
            // No DO, still try KV direct for local tests
            ctx?.waitUntil?.(
              (async () => {
                if (env?.KV) {
                  try {
                    const key = `coldpath:${kind}:${adapterId}:${crypto.randomUUID()}`;
                    await env.KV.put(key, JSON.stringify(entry), { expirationTtl: 7 * 24 * 3600 });
                  } catch {}
                }
              })()
            );
          }

          console.log(JSON.stringify({ level: 'error', event: `consumer_${kind}`, adapter: adapterId, reason: entry.reason, attempts: firstAttempts }));
        }
      }
    } catch (e: any) {
      console.log(JSON.stringify({ level: 'error', event: 'consumer_render_failed', adapter: adapterId, error: e?.message }));
      const related = chunkMap.get(pushMsg) ?? [];
      // Render failure -> non-retryable drop
      related.forEach((m) => m.ack());
      if (coordinatorStub && lane) {
        await coordinatorStub.release({ event_ids: toSendIds, lane, success: false, adapter_id: adapterId }).catch(() => {});
      }
      const entry = {
        kind: 'drop' as const,
        adapter: adapterId,
        reason: `render_failed: ${e?.message}`,
        attempts: related[0]?.attempts ?? 1,
        payload: pushMsg,
        received_at: new Date().toISOString()
      };
      if (coordinatorStub) {
        ctx?.waitUntil?.(
          (async () => {
            try {
              await coordinatorStub.archiveColdPath(entry);
            } catch {}
          })()
        );
      }
    }
  }
}

export default {
  async queue(batch: MessageBatch<QueuePayload>, env: any, ctx: any): Promise<void> {
    await handleQueueBatch(batch, env, ctx);
  }
};
