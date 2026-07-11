import type { InternalEvent, Severity } from '../decoder/types.js';

export type DispatchPolicy = 'immediate' | 'enqueue';
export type DispatchStrategy = 'all' | 'first_success';

export interface RouteResult {
  adapter_ids: string[];
  dispatch: DispatchPolicy;
  strategy: DispatchStrategy;
}

export interface Router {
  route(event: InternalEvent): RouteResult | null;
}

export interface RouteMatch {
  source_id?: string;
  event_type?: string;
  severity?: Severity;
}

export interface RoutingRule {
  match: RouteMatch;
  adapters: string[];
  dispatch?: DispatchPolicy;
  strategy?: DispatchStrategy;
}

export const LANE_ALLOCATION = {
  critical: { primary: 'high_exclusive', overflow: 'elastic' },
  high: { primary: 'high_exclusive', overflow: 'elastic' },
  medium: { primary: 'low_exclusive', overflow: 'elastic' },
  low: { primary: 'low_exclusive', overflow: 'elastic' },
  info: { primary: 'low_exclusive', overflow: 'elastic' }
} as const;
