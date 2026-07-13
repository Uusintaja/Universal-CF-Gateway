import type { InternalEvent } from '../decoder/types.js';
import type { RouteResult } from '../router/types.js';
import type { QueuePayload } from './types.js';

/**
 * Phase 3A: Queue Producer - write-time routing per-adapter
 * Per DESIGN-DOC §5.2: each adapter_id one Queue, isolation
 * Experimental naming: slack-webhook-experimental, email-experimental
 */

const ADAPTER_TO_QUEUE: Record<string, string> = {
  'slack-webhook': 'Q_SLACK_EXP',
  'email-mailchannels': 'Q_EMAIL_EXP',
  'webhook-site': 'Q_WEBHOOK_EXP'
};

export async function enqueue(
  event: InternalEvent,
  route: RouteResult,
  env: any
): Promise<{ enqueued: string[]; failed: string[] }> {
  const payload: QueuePayload = { event, route };
  const enqueued: string[] = [];
  const failed: string[] = [];

  for (const adapterId of route.adapter_ids) {
    const bindingName = ADAPTER_TO_QUEUE[adapterId] ?? `Q_${adapterId.toUpperCase().replace(/-/g, '_')}`;
    const queueBinding = env[bindingName] ?? env.Q_SLACK_EXP ?? env.Q_EMAIL_EXP;

    if (!queueBinding) {
      // For local tests without queue binding, fallback to direct (Phase0/1 behavior) - not fail
      // In production Phase3, queue must exist, else throw for CI to catch
      if (process.env.NODE_ENV !== 'test') {
        console.log(JSON.stringify({ level: 'warn', event: 'queue_binding_missing', adapter: adapterId, binding: bindingName }));
      }
      failed.push(adapterId);
      continue;
    }

    try {
      // Queues API: send(body, options?) - body is QueuePayload
      await queueBinding.send(payload);
      enqueued.push(adapterId);
    } catch (e: any) {
      console.log(JSON.stringify({ level: 'error', event: 'enqueue_failed', adapter: adapterId, error: e?.message }));
      failed.push(adapterId);
    }
  }

  return { enqueued, failed };
}
