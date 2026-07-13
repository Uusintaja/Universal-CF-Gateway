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

export interface RawPayload {
  bytes: Uint8Array;
  content_type?: string;
}

export interface RawInput {
  raw_payload: RawPayload;
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

export interface AcquireInput {
  event_ids: string[];
  severity: Severity;
}

export type Lane = "high_exclusive" | "low_exclusive" | "elastic";

export type AcquireResult =
  | {
      allowed: true;
      lane: Lane | null;
      lease_id: string | null;
      to_send_ids: string[];
    }
  | {
      allowed: false;
      reason: "circuit_open" | "lane_full";
    };

export interface ReleaseInput {
  lease_id: string;
  success: boolean;
}

export interface CoordinatorStatus {
  circuit: "closed" | "open" | "half_open";
  consecutive_failures: number;
  open_until?: number;
  lane_usage: { high_exclusive: number; low_exclusive: number; elastic: number };
  delivered_marker_count: number;
  delivered_marker_ttl_sec: number;
}

export interface CoordinatorRpc {
  acquire(input: AcquireInput): Promise<AcquireResult>;
  release(input: ReleaseInput): Promise<void>;
  status(): Promise<CoordinatorStatus>;
  checkDelivered(eventIds: string[]): Promise<{ delivered: string[]; not_delivered: string[] }>;
}

export interface QueueEnvelope {
  schema_version: "1.0";
  adapter_id: string;
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
  raw_payload: {
    encoding: "base64";
    bytes: string;
    content_type?: string;
  };
  created_at: string;
}

export interface Env {
  PHASE1_WEBHOOK_URL?: string;
  COORDINATOR?: DurableObjectNamespace;
  HTTP_WEBHOOK_QUEUE?: Queue<QueueEnvelope>;
  ALPHA_BATCH_WEBHOOK_QUEUE?: Queue<QueueEnvelope>;
  COLD_PATH_KV?: KVNamespace;
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
  raw_payload: RawPayload;
  trace: TraceRef;
  auth_context: AuthContext | null;
  metadata: Record<string, unknown>;
}

export type DecodeErrorCode = "BAD_BODY" | "UNAUTHORIZED" | "UNSUPPORTED" | "MALFORMED" | "PAYLOAD_TOO_COMPLEX" | "UNKNOWN";

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
  raw_payload: RawPayload;
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
        body: string | Uint8Array;
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
  readonly supportsBatch?: boolean;
  render(message: InternalPushMessage, context: AdapterContext): Promise<TransportRequest>;
  renderBatch?(message: InternalPushMessage, context: AdapterContext): Promise<TransportRequest>;
}
