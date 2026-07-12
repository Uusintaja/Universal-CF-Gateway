import { deriveGatewayEventId, EventIdComplexityError } from "./event-id";
import { InternalEventSchema } from "./schema";
import type { Decoder, DecodeError, InternalEvent, RawInput, RequestMeta } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(message: string): DecodeError {
  return { code: "MALFORMED", message, http_status: 400 };
}

function tooComplex(message: string): DecodeError {
  return { code: "PAYLOAD_TOO_COMPLEX", message, http_status: 413 };
}

function asMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export const genericJsonDecoder: Decoder = {
  id: "generic-json-webhook",

  async decode(input: RawInput, meta: RequestMeta) {
    let payload: unknown;
    const text = new TextDecoder().decode(input.raw_payload.bytes);
    try {
      payload = JSON.parse(text);
    } catch {
      return malformed("Request body must be valid JSON");
    }

    if (!isRecord(payload)) return malformed("Request body must be a JSON object");

    let eventId: string;
    try {
      eventId = await deriveGatewayEventId(meta.source_id, payload, input.raw_payload.content_type);
    } catch (error) {
      if (error instanceof EventIdComplexityError) return tooComplex(error.message);
      return { code: "UNKNOWN", message: "Could not derive gateway event_id", http_status: 400 };
    }

    const sourceTrace = isRecord(payload.trace) && typeof payload.trace.source_trace === "string"
      ? payload.trace.source_trace
      : typeof payload.event_id === "string" ? payload.event_id : undefined;
    const body = Object.prototype.hasOwnProperty.call(payload, "body")
      ? payload.body
      : Object.prototype.hasOwnProperty.call(payload, "payload")
        ? payload.payload
        : payload;

    const candidate = {
      schema_version: payload.schema_version === undefined ? "1.0" : payload.schema_version,
      event_id: eventId,
      source_id: meta.source_id,
      event_type: typeof payload.event_type === "string" ? payload.event_type : "",
      severity: payload.severity,
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

    const event: InternalEvent = {
      ...parsed.data,
      raw_payload: input.raw_payload,
    };
    return event;
  },
};
