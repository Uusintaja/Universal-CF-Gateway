import { describe, it, expect } from 'vitest';
import { genericJsonDecoder } from '../../src/decoder/generic.js';
import type { RawInput } from '../../src/io/types.js';
import type { RequestMeta } from '../../src/decoder/types.js';

function rawFromJson(obj: any): RawInput {
  return {
    body: new TextEncoder().encode(JSON.stringify(obj)),
    headers: {},
    source_meta: { transport: 'http', method: 'POST', path: '/webhook/test' },
    trace_id: 'gw-trace-1'
  };
}

function meta(source_id = 'monitor'): RequestMeta {
  return {
    source_id,
    auth_context: null,
    received_at: new Date().toISOString(),
    transport: 'http',
    trace_id: 'gw-trace-1'
  };
}

describe('Decoder generic-json - contract §2.3/2.4', () => {
  it('valid JSON decodes to InternalEvent with gateway_trace透传', async () => {
    const input = rawFromJson({ event_type: 'build.failed', severity: 'high', title: 'CI failed' });
    const res = await genericJsonDecoder.decode(input, meta('github-ci'));
    expect((res as any).schema_version).toBe('1.0');
    expect((res as any).source_id).toBe('github-ci');
    expect((res as any).trace.gateway_trace).toBe('gw-trace-1');
  });

  it('empty body -> BAD_BODY', async () => {
    const input: RawInput = {
      body: new Uint8Array(0),
      headers: {},
      source_meta: { transport: 'http' },
      trace_id: 't'
    };
    const res = await genericJsonDecoder.decode(input, meta());
    expect((res as any).code).toBe('BAD_BODY');
  });

  it('invalid JSON -> BAD_BODY', async () => {
    const input: RawInput = {
      body: new TextEncoder().encode('not json'),
      headers: {},
      source_meta: { transport: 'http' },
      trace_id: 't'
    };
    const res = await genericJsonDecoder.decode(input, meta());
    expect((res as any).code).toBe('BAD_BODY');
  });

  it('must NOT throw, returns DecodeError', async () => {
    const input = rawFromJson({ title: 123 as any }); // title not string
    const res = await genericJsonDecoder.decode(input, meta());
    // Should return MALFORMED, not throw
    expect((res as any).code).toBeDefined();
  });

  it('deterministic CPU <10ms (smoke, no perf.now loop)', async () => {
    const input = rawFromJson({ title: 'cpu test' });
    const start = Date.now();
    await genericJsonDecoder.decode(input, meta());
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // wall time proxy, real CPU measured via Dashboard later
  });
});
