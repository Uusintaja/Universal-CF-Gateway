export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface TraceRef {
  source_trace?: string;
  gateway_trace: string;
}

export interface AuthContext {
  source_id: string;
  verified: boolean;
  principal?: string;
  [key: string]: unknown;
}

export interface RawInput {
  body: Uint8Array;
  headers: Record<string, string>;
  gateway_trace: string;
  source_meta: {
    transport: "http" | "email";
    method?: string;
    path?: string;
    email?: { from: string; to: string; subject: string };
  };
}

export interface RequestMeta {
  source_id: string;
  auth_context: AuthContext | null;
  received_at: string;
  transport: "http" | "email";
}

export interface InternalEvent {
  schema_version: "1.0";
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

export type DecodeErrorCode = "BAD_BODY" | "UNAUTHORIZED" | "UNSUPPORTED" | "MALFORMED" | "UNKNOWN";

export interface DecodeError {
  code: DecodeErrorCode;
  message: string;
  http_status?: number;
}

export type DecodeResult = InternalEvent | DecodeError;

export interface Decoder {
  readonly id: string;
  decode(input: RawInput, meta: RequestMeta): Promise<DecodeResult>;
}

export type DispatchPolicy = "immediate" | "enqueue";
export type DispatchStrategy = "all" | "first_success";

export interface RouteResult {
  adapter_ids: string[];
  dispatch: DispatchPolicy;
  strategy: DispatchStrategy;
}

export interface Router {
  route(event: InternalEvent): RouteResult | null;
}

export interface PushItem {
  event_id: string;
  title: string;
  body: unknown;
  severity: Severity;
  timestamp: string;
  trace: TraceRef;
}

export interface InternalPushMessage {
  schema_version: "1.0";
  message_id: string;
  target_adapter: string;
  severity: Severity;
  items: PushItem[];
  chunk: { index: number; total: number };
  attempt: number;
  created_at: string;
}

export type TransportRequest =
  | {
      transport: "http";
      request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        body: string;
      };
    }
  | {
      transport: "email";
      request: { from: string; to: string; raw_mime: string };
    };

export interface SendError {
  code: "RATE_LIMITED" | "UPSTREAM_5XX" | "NETWORK" | "INVALID_MESSAGE" | "CIRCUIT_OPEN" | "UNKNOWN";
  message: string;
  retryable: boolean;
  http_status?: number;
}

export interface AdapterConfig {
  immediateRetries: number;
  circuitThreshold: number;
  circuitOpenSec: number;
}

export interface AdapterContext {
  secrets: Record<string, string>;
  config: AdapterConfig;
}

export interface ChannelAdapter {
  readonly id: string;
  readonly config: AdapterConfig;
  render(message: InternalPushMessage, context: AdapterContext): Promise<TransportRequest>;
}
