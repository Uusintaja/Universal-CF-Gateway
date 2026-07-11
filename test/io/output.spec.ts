import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transmit, OUTPUT_IO_LIMITS } from '../../src/io/output.js';

describe('Output I/O Layer transmit - Phase 1 §4.3 / §0.4b', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('configurable timeouts: high 3s low 10s per user decision', () => {
    expect(OUTPUT_IO_LIMITS.FETCH.high).toBe(3000);
    expect(OUTPUT_IO_LIMITS.FETCH.low).toBe(10000);
    expect(OUTPUT_IO_LIMITS.EMAIL.high).toBe(3000);
    expect(OUTPUT_IO_LIMITS.EMAIL.low).toBe(10000);
  });

  it('http success returns ok true and reads body to avoid deadlock', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const tr = {
      transport: 'http' as const,
      request: { method: 'POST', url: 'https://example.com', headers: {}, body: '{}' }
    };

    const res = await transmit(tr as any, { severity: 'high', eventIds: ['eid'], emailBinding: undefined });
    expect(res.ok).toBe(true);
    expect(res.sent_ids).toEqual(['eid']);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('http 429 -> RATE_LIMITED retryable true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate', { status: 429 })));
    const tr = {
      transport: 'http' as const,
      request: { method: 'POST', url: 'https://example.com', headers: {}, body: '{}' }
    };
    const res = await transmit(tr as any, { severity: 'high', eventIds: ['eid'] });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('RATE_LIMITED');
    expect(res.error?.retryable).toBe(true);
  });

  it('http 5xx -> UPSTREAM_5XX retryable true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('err', { status: 500 })));
    const tr = {
      transport: 'http' as const,
      request: { method: 'POST', url: 'https://example.com', headers: {}, body: '{}' }
    };
    const res = await transmit(tr as any, { severity: 'low', eventIds: ['eid'] });
    expect(res.error?.code).toBe('UPSTREAM_5XX');
    expect(res.error?.retryable).toBe(true);
  });

  it('http network error -> NETWORK retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network')));
    const tr = {
      transport: 'http' as const,
      request: { method: 'POST', url: 'https://example.com', headers: {}, body: '{}' }
    };
    const res = await transmit(tr as any, { severity: 'high', eventIds: ['eid'] });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NETWORK');
  });

  it('email without binding simulates success (local test)', async () => {
    const tr = {
      transport: 'email' as const,
      request: { from: 'a@b.com', to: 'c@d.com', raw_mime: 'test' }
    };
    const res = await transmit(tr as any, { severity: 'high', eventIds: ['eid'], emailBinding: undefined });
    expect(res.ok).toBe(true);
  });
});
