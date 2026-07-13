import type { InternalEvent, InternalPushMessage, QueueEnvelope, RawPayload, Severity } from "./types";

export const QUEUE_PUSH_LIMITS = {
  MAX_ITEMS_PER_MESSAGE: 50,
  MAX_BYTES_PER_MESSAGE: 24_000,
} as const;

export interface QueuePushChunk {
  message: InternalPushMessage;
  envelopes: QueueEnvelope[];
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toQueueEnvelope(event: InternalEvent, adapterId: string): QueueEnvelope {
  return {
    schema_version: "1.0",
    adapter_id: adapterId,
    event_id: event.event_id,
    source_id: event.source_id,
    event_type: event.event_type,
    severity: event.severity,
    timestamp: event.timestamp,
    title: event.title,
    body: event.body,
    trace: event.trace,
    auth_context: event.auth_context,
    metadata: event.metadata,
    raw_payload: {
      encoding: "base64",
      bytes: encodeBase64(event.raw_payload.bytes),
      content_type: event.raw_payload.content_type,
    },
    created_at: new Date().toISOString(),
  };
}

export function rawPayloadFromEnvelope(envelope: QueueEnvelope): RawPayload {
  if (envelope.raw_payload.encoding !== "base64") {
    throw new Error("Unsupported Queue raw_payload encoding");
  }
  return {
    bytes: decodeBase64(envelope.raw_payload.bytes),
    content_type: envelope.raw_payload.content_type,
  };
}

function severityRank(severity: Severity): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity];
}

function maxSeverity(envelopes: QueueEnvelope[]): Severity {
  return envelopes.reduce((max, envelope) => severityRank(envelope.severity) > severityRank(max) ? envelope.severity : max, "info" as Severity);
}

function itemFromEnvelope(envelope: QueueEnvelope) {
  return {
    event_id: envelope.event_id,
    title: envelope.title,
    body: envelope.body,
    raw_payload: rawPayloadFromEnvelope(envelope),
    severity: envelope.severity,
    timestamp: envelope.timestamp,
    trace: envelope.trace,
  };
}

function estimateEnvelopeBytes(envelope: QueueEnvelope): number {
  return envelope.raw_payload.bytes.length + JSON.stringify(envelope.body).length + 256;
}

function makeChunk(envelopes: QueueEnvelope[], index: number, total: number): QueuePushChunk {
  const items = envelopes.map(itemFromEnvelope);
  return {
    envelopes,
    message: {
      schema_version: "1.0",
      message_id: `batch:${envelopes.map((envelope) => envelope.event_id).join(",")}`,
      target_adapter: envelopes[0].adapter_id,
      severity: maxSeverity(envelopes),
      items,
      chunk: { index, total },
      attempt: 0,
      created_at: envelopes[0].created_at,
    },
  };
}

export function buildPushChunks(envelopes: QueueEnvelope[], supportsBatch: boolean): QueuePushChunk[] {
  if (envelopes.length === 0) return [];
  if (!supportsBatch) return envelopes.map((envelope, index) => makeChunk([envelope], index, envelopes.length));

  const groups: QueueEnvelope[][] = [];
  let current: QueueEnvelope[] = [];
  let currentBytes = 0;
  for (const envelope of envelopes) {
    const size = estimateEnvelopeBytes(envelope);
    const wouldExceedItems = current.length >= QUEUE_PUSH_LIMITS.MAX_ITEMS_PER_MESSAGE;
    const wouldExceedBytes = current.length > 0 && currentBytes + size > QUEUE_PUSH_LIMITS.MAX_BYTES_PER_MESSAGE;
    if (wouldExceedItems || wouldExceedBytes) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(envelope);
    currentBytes += size;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group, index) => makeChunk(group, index, groups.length));
}

export function pushMessageFromEnvelope(envelope: QueueEnvelope): InternalPushMessage {
  return makeChunk([envelope], 0, 1).message;
}
