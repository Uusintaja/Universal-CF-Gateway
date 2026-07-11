import type { InternalPushMessage } from '../push/types.js';

export type TransportRequest =
  | { transport: 'http'; request: { method: string; url: string; headers: Record<string, string>; body: string } }
  | { transport: 'email'; request: { from: string; to: string; raw_mime: string } };

export interface SendError {
  code: 'RATE_LIMITED' | 'UPSTREAM_5XX' | 'NETWORK' | 'INVALID_MESSAGE' | 'CIRCUIT_OPEN' | 'UNKNOWN';
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
  render(msg: InternalPushMessage, ctx: AdapterContext): Promise<TransportRequest>;
}

export type AdapterRegistry = Record<string, ChannelAdapter>;
