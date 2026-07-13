import type { InternalEvent } from '../decoder/types.js';
import type { InternalPushMessage, PushItem } from '../push/types.js';
import { MAX_ITEMS_PER_MESSAGE, MAX_BYTES_PER_MESSAGE, MAX_EMAIL_ITEMS, estimatedSize } from '../push/types.js';

/**
 * Phase 3A: Merge & Chunk dual threshold per DESIGN-DOC §3.1
 * - MAX_ITEMS_PER_MESSAGE 50
 * - MAX_BYTES_PER_MESSAGE 24000
 * - MAX_EMAIL_ITEMS 10
 * Batch-internal only, not cross-batch, Map lifecycle = single invocation
 */

export function toPushItem(event: InternalEvent): PushItem {
  return {
    event_id: event.event_id,
    title: event.title,
    body: event.body,
    severity: event.severity,
    timestamp: event.timestamp,
    trace: event.trace
  };
}

function maxSeverity(items: PushItem[]): any {
  const order: any = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  let max = 'info';
  let maxVal = 0;
  for (const it of items) {
    const v = order[it.severity] ?? 0;
    if (v > maxVal) {
      maxVal = v;
      max = it.severity;
    }
  }
  return max;
}

export function chunkByDualThreshold(
  events: InternalEvent[],
  targetAdapter: string,
  isEmail = false
): InternalPushMessage[] {
  if (events.length === 0) return [];

  const maxItems = isEmail ? Math.min(MAX_ITEMS_PER_MESSAGE, MAX_EMAIL_ITEMS) : MAX_ITEMS_PER_MESSAGE;
  const chunks: InternalPushMessage[][] = [];
  let currentItems: PushItem[] = [];
  let currentBytes = 0;

  const flush = () => {
    if (currentItems.length === 0) return;
    const msg: InternalPushMessage = {
      schema_version: '1.0',
      message_id: crypto.randomUUID(),
      target_adapter: targetAdapter,
      severity: maxSeverity(currentItems),
      items: [...currentItems],
      chunk: { index: 0, total: 0 }, // total filled later
      attempt: 0,
      created_at: new Date().toISOString()
    };
    chunks.push([msg]); // each flush is one message for now, will flatten
    currentItems = [];
    currentBytes = 0;
  };

  for (const ev of events) {
    const item = toPushItem(ev);
    const size = estimatedSize(item);

    // Single item over threshold -> alone
    if (size > MAX_BYTES_PER_MESSAGE) {
      flush();
      const solo: InternalPushMessage = {
        schema_version: '1.0',
        message_id: crypto.randomUUID(),
        target_adapter: targetAdapter,
        severity: item.severity,
        items: [item],
        chunk: { index: 0, total: 0 },
        attempt: 0,
        created_at: new Date().toISOString()
      };
      chunks.push([solo]);
      continue;
    }

    if (currentItems.length >= maxItems || currentBytes + size > MAX_BYTES_PER_MESSAGE) {
      flush();
    }
    currentItems.push(item);
    currentBytes += size;
  }
  flush();

  // Flatten and assign chunk index/total
  const flat = chunks.flat();
  const total = flat.length;
  flat.forEach((m, i) => {
    m.chunk = { index: i, total };
  });
  return flat;
}
