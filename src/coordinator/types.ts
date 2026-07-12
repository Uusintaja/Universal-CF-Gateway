import type { Severity } from '../decoder/types.js';
import type { Lane } from './constants.js';

export interface AcquirePayload {
  event_ids: string[];
  severity: Severity;
  adapter_id?: string; // for circuit scoping per adapter
}

export type AcquireResult =
  | { allowed: true; lane: Lane; to_send_ids: string[] }
  | { allowed: false; reason: 'circuit_open' | 'lane_full' };

export interface ReleasePayload {
  event_ids: string[];
  lane: Lane;
  success: boolean;
  adapter_id?: string;
}

export interface ColdPathEntry {
  kind: 'dlq' | 'drop' | 'unmatched';
  adapter?: string;
  reason: string;
  attempts?: number;
  payload: unknown;
  received_at: string;
}

export interface CircuitState {
  state: 'open' | 'closed';
  failures: number;
  opened_at?: number; // ms epoch
  threshold: number;
  openSec: number;
}

export interface LaneCounters {
  high_exclusive: number;
  low_exclusive: number;
  elastic: number;
}

export interface DeliveredMarker {
  event_id: string;
  ts: number;
  expires_at: number;
}
