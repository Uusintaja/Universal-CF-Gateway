import type { InternalEvent, InternalPushMessage, QueueEnvelope, RawPayload } from "./types";

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

export function pushMessageFromEnvelope(envelope: QueueEnvelope): InternalPushMessage {
  return {
    schema_version: "1.0",
    message_id: envelope.event_id,
    target_adapter: envelope.adapter_id,
    severity: envelope.severity,
    items: [{
      event_id: envelope.event_id,
      title: envelope.title,
      body: envelope.body,
      raw_payload: rawPayloadFromEnvelope(envelope),
      severity: envelope.severity,
      timestamp: envelope.timestamp,
      trace: envelope.trace,
    }],
    chunk: { index: 0, total: 1 },
    attempt: 0,
    created_at: envelope.created_at,
  };
}
