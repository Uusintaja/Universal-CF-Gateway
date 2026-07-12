import type { Severity } from '../decoder/types.js';

export type Lane = 'high_exclusive' | 'low_exclusive' | 'elastic';

export const LANE_LIMITS: Record<Lane, number> = {
  high_exclusive: 1,
  low_exclusive: 1,
  elastic: 4
};

export const LANE_ALLOCATION: Record<Severity, { primary: Lane; overflow: 'elastic' }> = {
  critical: { primary: 'high_exclusive', overflow: 'elastic' },
  high: { primary: 'high_exclusive', overflow: 'elastic' },
  medium: { primary: 'low_exclusive', overflow: 'elastic' },
  low: { primary: 'low_exclusive', overflow: 'elastic' },
  info: { primary: 'low_exclusive', overflow: 'elastic' }
};

export const CIRCUIT_DEFAULTS = {
  threshold: 5,
  openSec: 60
} as const;

export const DEDUP_TTL_MS = 1000 * 1000; // 1000s per §4.5 = max_batch_timeout(900)+visibility(30)+margin
