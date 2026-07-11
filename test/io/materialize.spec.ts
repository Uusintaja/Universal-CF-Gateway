import { describe, it, expect, vi } from 'vitest';
import { materializeHttp, materializeEmail } from '../../src/io/input.js';
import { INPUT_IO_LIMITS } from '../../src/io/types.js';

describe('Input I/O Layer - materialize contract DESIGN-DOC §2.2', () => {
  it('HTTP: normal body materialized to Uint8Array + trace_id + headers normalized', async () => {
    const req = new Request('https://example.com/webhook/github-ci', {
      method: 'POST',
      headers: { 'X-Gateway-Source': 'github-ci', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    });
    const raw = await materializeHttp(req);
    expect(raw.body).toBeInstanceOf(Uint8Array);
    expect(raw.body.byteLength).toBeGreaterThan(0);
    expect(raw.trace_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw.headers['x-gateway-source']).toBe('github-ci');
    expect(raw.source_meta.transport).toBe('http');
  });

  it('HTTP: Content-Length > MAX -> 413', async () => {
    const big = new Uint8Array(INPUT_IO_LIMITS.MAX_BODY_BYTES + 1);
    const req = new Request('https://example.com/', {
      method: 'POST',
      headers: { 'content-length': String(big.byteLength) },
      body: big
    });
    await expect(materializeHttp(req)).rejects.toThrow(/PAYLOAD_TOO_LARGE/);
  });

  it('Email: rawSize > MAX -> setReject 552 + throw oversize', async () => {
    const setReject = vi.fn();
    const msg = {
      raw: new ReadableStream({ start(c) { c.close(); } }) as any,
      rawSize: INPUT_IO_LIMITS.MAX_BODY_BYTES + 100,
      headers: new Headers({ subject: 'test' }),
      from: 'a@b.com',
      to: 'c@d.com',
      setReject
    };
    await expect(materializeEmail(msg as any)).rejects.toThrow(/OVERSIZE_EMAIL/);
    expect(setReject).toHaveBeenCalledWith('552 Message too large');
  });

  it('Email: normal raw materialized', async () => {
    const body = new TextEncoder().encode('hello email');
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(body);
        c.close();
      }
    });
    const msg = {
      raw: stream as any,
      rawSize: body.byteLength,
      headers: new Headers({ subject: 'hi' }),
      from: 'a@b.com',
      to: 'c@d.com',
      setReject: vi.fn()
    };
    const raw = await materializeEmail(msg as any);
    expect(raw.body).toBeInstanceOf(Uint8Array);
    expect(raw.trace_id).toBeDefined();
    expect(raw.source_meta.transport).toBe('email');
  });
});
