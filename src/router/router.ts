import type { Router, RouteResult, RoutingRule } from './types.js';
import type { InternalEvent } from '../decoder/types.js';

/**
 * Hard-coded routing table per DESIGN-DOC §5.6 - v1.0
 * severity default: critical|high -> immediate, medium|low|info -> enqueue
 * Explicit Router interface for test boundary clarity
 */
export const ROUTING_TABLE: { version: '1.0'; rules: RoutingRule[] } = {
  version: '1.0',
  rules: [
    {
      match: { source_id: 'github-ci', event_type: 'build.failed', severity: 'high' },
      adapters: ['slack-webhook', 'email-mailchannels'],
      dispatch: 'immediate',
      strategy: 'all'
    },
    {
      match: { source_id: 'monitor', severity: 'info' },
      adapters: ['email-mailchannels'],
      dispatch: 'enqueue',
      strategy: 'all'
    },
    {
      match: { source_id: 'monitor', severity: 'high' },
      adapters: ['slack-webhook', 'email-mailchannels'],
      dispatch: 'immediate',
      strategy: 'first_success'
    },
    {
      match: {}, // fallback
      adapters: ['email-mailchannels'],
      dispatch: 'enqueue',
      strategy: 'all'
    }
  ]
};

function matches(rule: RoutingRule, event: InternalEvent): boolean {
  const m = rule.match;
  if (m.source_id && m.source_id !== event.source_id) return false;
  if (m.event_type && m.event_type !== event.event_type) return false;
  if (m.severity && m.severity !== event.severity) return false;
  return true;
}

export function createRouter(table = ROUTING_TABLE): Router {
  return {
    route(event: InternalEvent): RouteResult | null {
      for (const rule of table.rules) {
        if (matches(rule, event)) {
          return {
            adapter_ids: rule.adapters,
            dispatch: rule.dispatch ?? (event.severity === 'critical' || event.severity === 'high' ? 'immediate' : 'enqueue'),
            strategy: rule.strategy ?? 'all'
          };
        }
      }
      return null; // unmatched -> should go to default email + archive per §5.6
    }
  };
}
