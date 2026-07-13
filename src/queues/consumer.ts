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

/**
 * Phase 3A Happy Path Consumer
 * - No retry, no cold path, only success path
 * - Batch-internal Map<PushMessage, Message[]> for ack tracing
 * - acquire -> to_send_ids -> render(subset) -> transmit -> release(true) -> ack
 * - For Phase 3B, will add lane_full/circuit_open retry, drop/archive
 */

export async function handleQueueBatch(
  batch: MessageBatch<QueuePayload>,
  env: any,
  ctx: any
): Promise<void> {
  if (batch.messages.length === 0) return;

  // Group events by target adapter (queue is per-adapter, but batch may still have mixed)
  const events = batch.messages.map((m) => m.body.event);
  const firstAdapter = batch.messages[0].body.route.adapter_ids[0] ?? 'email-mailchannels';
  const isEmail = firstAdapter.includes('email');

  const pushMessages = chunkByDualThreshold(events, firstAdapter, isEmail);

  // Map PushMessage -> source Messages for ack tracing per §3.2
  const chunkMap = new Map<any, typeof batch.messages>();
  // Simple mapping: for Happy Path, each PushMessage maps to all batch messages whose event_id in its items
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
          // Happy Path: just log and skip, Phase 3B will handle retry
          console.log(JSON.stringify({ level: 'warn', event: 'consumer_acquire_blocked_happy', adapter: adapterId, reason: acquireRes.reason }));
          continue;
        }
        if (acquireRes.to_send_ids.length === 0) {
          // All delivered -> ack skip
          const related = chunkMap.get(pushMsg) ?? [];
          related.forEach((m) => m.ack());
          continue;
        }
        toSendIds = acquireRes.to_send_ids;
        lane = acquireRes.lane;
        // Filter items to toSendIds subset
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

      if (txRes.ok) {
        const related = chunkMap.get(pushMsg) ?? [];
        related.forEach((m) => m.ack());
        console.log(JSON.stringify({ level: 'info', event: 'consumer_happy_ack', adapter: adapterId, sent: toSendIds.length }));
      } else {
        // Happy Path: no retry, just log; Phase 3B will handle retry/archive
        console.log(JSON.stringify({ level: 'warn', event: 'consumer_happy_failed_no_retry', adapter: adapterId, error: txRes.error }));
        // For 3A, still ack to avoid blocking? But per spec should retry, we keep as ack for happy path
        const related = chunkMap.get(pushMsg) ?? [];
        related.forEach((m) => m.ack());
      }
    } catch (e: any) {
      console.log(JSON.stringify({ level: 'error', event: 'consumer_render_failed', adapter: adapterId, error: e?.message }));
      const related = chunkMap.get(pushMsg) ?? [];
      related.forEach((m) => m.ack());
      if (coordinatorStub && lane) {
        await coordinatorStub.release({ event_ids: toSendIds, lane, success: false, adapter_id: adapterId }).catch(() => {});
      }
    }
  }
}

// Cloudflare Workers Queue handler entry
export default {
  async queue(batch: MessageBatch<QueuePayload>, env: any, ctx: any): Promise<void> {
    await handleQueueBatch(batch, env, ctx);
  }
};
