import type { TransportRequest, SendError } from '../adapter/types.js';
import type { Severity } from '../decoder/types.js';

/**
 * Output I/O Layer - Phase 1: direct transmit without DO gating (DO in Phase 2)
 * Per DESIGN-DOC §4.3/§4.8 and your decision: high 3s, low 10s, configurable
 */

export const OUTPUT_IO_LIMITS = {
  FETCH: {
    high: 3000,
    low: 10000
  },
  EMAIL: {
    high: 3000,
    low: 10000
  }
} as const;

function timeoutFor(transport: 'http' | 'email', severity: Severity): number {
  const isHigh = severity === 'critical' || severity === 'high';
  if (transport === 'email') {
    return isHigh ? OUTPUT_IO_LIMITS.EMAIL.high : OUTPUT_IO_LIMITS.EMAIL.low;
  }
  return isHigh ? OUTPUT_IO_LIMITS.FETCH.high : OUTPUT_IO_LIMITS.FETCH.low;
}

// Must read body to avoid TCP pool deadlock per §0.4b
async function safeReadBody(res: Response): Promise<void> {
  try {
    // Read or cancel to recycle connection
    if (res.body) {
      await res.text().catch(() => res.body?.cancel());
    }
  } catch {
    try {
      await res.body?.cancel();
    } catch {}
  }
}

function classifyHttpError(status: number): SendError {
  if (status === 429) {
    return { code: 'RATE_LIMITED', message: `429 Rate Limited`, retryable: true, http_status: status };
  }
  if (status >= 500) {
    return { code: 'UPSTREAM_5XX', message: `Upstream ${status}`, retryable: true, http_status: status };
  }
  if (status >= 400) {
    return { code: 'INVALID_MESSAGE', message: `Client ${status}`, retryable: false, http_status: status };
  }
  return { code: 'UNKNOWN', message: `HTTP ${status}`, retryable: false, http_status: status };
}

export interface TransmitResult {
  ok: boolean;
  sent_ids: string[];
  error?: SendError;
}

/**
 * Phase 1 transmit - direct (no DO). Phase 2 will wrap with coordinator acquire/release
 * Returns only to_send_ids that were attempted (for Phase 0 single item = event_id)
 */
export async function transmit(
  tr: TransportRequest,
  opts: { severity: Severity; eventIds: string[]; emailBinding?: { send: (msg: any) => Promise<any> } }
): Promise<TransmitResult> {
  const { severity, eventIds } = opts;
  // For Phase 1, to_send = all (no dedup yet)
  const toSend = eventIds;

  try {
    if (tr.transport === 'http') {
      const timeout = timeoutFor('http', severity);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let res: Response;
      try {
        res = await fetch(tr.request.url, {
          method: tr.request.method,
          headers: tr.request.headers,
          body: tr.request.body,
          signal: controller.signal
        });
      } catch (e: any) {
        clearTimeout(timer);
        const isTimeout = e?.name === 'AbortError';
        return {
          ok: false,
          sent_ids: [],
          error: {
            code: isTimeout ? 'NETWORK' : 'NETWORK',
            message: isTimeout ? `Timeout ${timeout}ms` : e?.message ?? 'Network error',
            retryable: true
          }
        };
      }
      clearTimeout(timer);

      // Must read body per §0.4b
      await safeReadBody(res);

      if (!res.ok) {
        return { ok: false, sent_ids: [], error: classifyHttpError(res.status) };
      }
      return { ok: true, sent_ids: toSend };
    } else {
      // email
      const timeout = timeoutFor('email', severity);
      const emailBinding = opts.emailBinding;

      if (!emailBinding) {
        // Local test without binding - simulate success, keep CPU <10ms path
        // Real send will be via env.EMAIL in Phase 1 after deploy
        return { ok: true, sent_ids: toSend };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        // Cloudflare Email Routing API: EMAIL.send({from, to, raw})
        // raw_mime is string, need to handle
        await (emailBinding as any).send(tr.request as any);
        clearTimeout(timer);
        return { ok: true, sent_ids: toSend };
      } catch (e: any) {
        clearTimeout(timer);
        const msg = e?.message ?? String(e);
        const isTimeout = msg.includes('Timeout') || e?.name === 'AbortError';
        return {
          ok: false,
          sent_ids: [],
          error: {
            code: isTimeout ? 'NETWORK' : 'UPSTREAM_5XX',
            message: msg,
            retryable: true
          }
        };
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      sent_ids: [],
      error: { code: 'UNKNOWN', message: e?.message ?? String(e), retryable: false }
    };
  }
}
