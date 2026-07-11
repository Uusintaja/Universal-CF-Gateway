import type { Decoder, InternalEvent, DecodeError, RequestMeta } from './types.js';
import type { RawInput } from '../io/types.js';

/**
 * Generic JSON Decoder - Phase 0 minimal implementation
 * Contract per DESIGN-DOC §2.3/2.4:
 * - Stateless, pure, no I/O, deterministic CPU <10ms
 * - Returns DecodeError, never throws raw
 * - Deterministic event_id generation (from body if present else random)
 */

export const genericJsonDecoder: Decoder = {
  id: 'generic-json',

  async decode(input: RawInput, meta: RequestMeta): Promise<InternalEvent | DecodeError> {
    try {
      const text = new TextDecoder().decode(input.body);
      if (!text) {
        return { code: 'BAD_BODY', message: 'Empty body', http_status: 400 };
      }

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return { code: 'BAD_BODY', message: 'Invalid JSON', http_status: 400 };
      }

      // Minimal required fields, with defaults to make Phase 0 usable
      const event_id = json.event_id ?? crypto.randomUUID();
      const event_type = json.event_type ?? 'generic';
      const severity = json.severity ?? 'low';
      const title = json.title ?? `Event from ${meta.source_id}`;
      const body = json.body ?? json;
      const timestamp = json.timestamp ?? new Date().toISOString();

      // Basic validation (Zod will be added later per §6.1)
      if (typeof event_id !== 'string' || typeof title !== 'string') {
        return { code: 'MALFORMED', message: 'event_id/title must be string', http_status: 400 };
      }

      const event: InternalEvent = {
        schema_version: '1.0',
        event_id,
        source_id: meta.source_id,
        event_type,
        severity,
        timestamp,
        title,
        body,
        trace: {
          source_trace: json.trace_id,
          gateway_trace: meta.trace_id
        },
        auth_context: meta.auth_context,
        metadata: {
          transport: meta.transport,
          received_at: meta.received_at
        }
      };

      return event;
    } catch (e: any) {
      return { code: 'UNKNOWN', message: e?.message ?? 'Unknown decode error', http_status: 500 };
    }
  }
};
