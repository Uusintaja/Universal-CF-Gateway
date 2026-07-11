import type { RawInput } from '../io/types.js';

export interface TraceRef {
  source_trace?: string;
  gateway_trace: string;
}

export interface AuthContext {
  source_id: string;
  verified: boolean;
  principal?: string;
  [k: string]: unknown;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface InternalEvent {
  schema_version: '1.0';
  event_id: string;
  source_id: string;
  event_type: string;
  severity: Severity;
  timestamp: string;
  title: string;
  body: unknown;
  trace: TraceRef;
  auth_context: AuthContext | null;
  metadata: Record<string, unknown>;
}

export interface RequestMeta {
  source_id: string;
  auth_context: AuthContext | null;
  received_at: string;
  transport: 'http' | 'email';
  trace_id: string;
}

export interface DecodeError {
  code: 'BAD_BODY' | 'UNAUTHORIZED' | 'UNSUPPORTED' | 'MALFORMED' | 'UNKNOWN';
  message: string;
  http_status?: number;
}

export interface Decoder {
  readonly id: string;
  decode(input: RawInput, meta: RequestMeta): Promise<InternalEvent | DecodeError>;
}

export type DecoderRegistry = Record<string, Decoder>;
