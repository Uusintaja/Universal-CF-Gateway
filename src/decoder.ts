import { InternalEventSchema } from "./schema";
import type { Decoder, DecodeError, InternalEvent, RawInput, RequestMeta } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableUuid(seed: string): string {
  const bytes = new TextEncoder().encode(seed);
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const words = seeds.map((initial) => {
    let hash = initial;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
  const hex = words.map((word) => word.toString(16).padStart(8, "0")).join("");
  const normalized = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
  return normalized;
}

function malformed(message: string): DecodeError {
  return { code: "MALFORMED", message, http_status: 400 };
}

function asMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export const genericJsonDecoder: Decoder = {
  id: "generic-json-webhook",

  async decode(input: RawInput, meta: RequestMeta) {
    let payload: unknown;
    const text = new TextDecoder().decode(input.body);
    try {
      payload = JSON.parse(text);
    } catch {
      return malformed("Request body must be valid JSON");
    }

    if (!isRecord(payload)) return malformed("Request body must be a JSON object");

    const sourceTrace = isRecord(payload.trace) && typeof payload.trace.source_trace === "string"
      ? payload.trace.source_trace
      : undefined;
    const eventId = typeof payload.event_id === "string"
      ? payload.event_id
      : stableUuid(`${meta.source_id}\u0000${text}`);
    const body = Object.prototype.hasOwnProperty.call(payload, "body")
      ? payload.body
      : Object.prototype.hasOwnProperty.call(payload, "payload")
        ? payload.payload
        : payload;

    const candidate: InternalEvent = {
      schema_version: payload.schema_version === undefined ? "1.0" : payload.schema_version as "1.0",
      event_id: eventId,
      source_id: meta.source_id,
      event_type: typeof payload.event_type === "string" ? payload.event_type : "",
      severity: payload.severity as InternalEvent["severity"],
      timestamp: typeof payload.timestamp === "string" ? payload.timestamp : meta.received_at,
      title: typeof payload.title === "string" ? payload.title : "",
      body,
      trace: sourceTrace === undefined
        ? { gateway_trace: input.gateway_trace }
        : { source_trace: sourceTrace, gateway_trace: input.gateway_trace },
      auth_context: meta.auth_context,
      metadata: asMetadata(payload.metadata),
    };

    const parsed = InternalEventSchema.safeParse(candidate);
    if (!parsed.success) return malformed("Decoded event does not match the InternalEvent schema");
    return parsed.data;
  },
};
