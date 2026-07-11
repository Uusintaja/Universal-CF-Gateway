import type { Severity, TraceRef } from '../decoder/types.js';

export interface PushItem {
  event_id: string;
  title: string;
  body: unknown;
  severity: Severity;
  timestamp: string;
  trace: TraceRef;
}

export interface InternalPushMessage {
  schema_version: '1.0';
  message_id: string;
  target_adapter: string;
  severity: Severity;
  items: PushItem[];
  chunk: { index: number; total: number };
  attempt: number;
  created_at: string;
}

export const MAX_ITEMS_PER_MESSAGE = 50;
export const MAX_BYTES_PER_MESSAGE = 24_000;
export const MAX_EMAIL_ITEMS = 10;

export const estimatedSize = (item: PushItem): number =>
  new TextEncoder().encode(JSON.stringify(item)).length;
