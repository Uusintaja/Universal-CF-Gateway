import { describe, it, expect } from 'vitest';
import { createRouter, ROUTING_TABLE } from '../../src/router/router.js';
import type { InternalEvent } from '../../src/decoder/types.js';

function fakeEvent(overrides: Partial<InternalEvent>): InternalEvent {
  return {
    schema_version: '1.0',
    event_id: 'test-id',
    source_id: 'monitor',
    event_type: 'test',
    severity: 'info',
    timestamp: new Date().toISOString(),
    title: 'test',
    body: {},
    trace: { gateway_trace: 'gt' },
    auth_context: null,
    metadata: {},
    ...overrides
  } as InternalEvent;
}

describe('Router - hard-coded table §5.6', () => {
  const router = createRouter(ROUTING_TABLE);

  it('github-ci build.failed high -> immediate all slack+email', () => {
    const ev = fakeEvent({ source_id: 'github-ci', event_type: 'build.failed', severity: 'high' });
    const res = router.route(ev);
    expect(res).not.toBeNull();
    expect(res?.adapter_ids).toContain('slack-webhook');
    expect(res?.adapter_ids).toContain('email-mailchannels');
    expect(res?.dispatch).toBe('immediate');
    expect(res?.strategy).toBe('all');
  });

  it('monitor info -> enqueue email', () => {
    const ev = fakeEvent({ source_id: 'monitor', severity: 'info' });
    const res = router.route(ev);
    expect(res?.adapter_ids).toEqual(['email-mailchannels']);
    expect(res?.dispatch).toBe('enqueue');
  });

  it('monitor high -> immediate first_success', () => {
    const ev = fakeEvent({ source_id: 'monitor', severity: 'high' });
    const res = router.route(ev);
    expect(res?.strategy).toBe('first_success');
    expect(res?.dispatch).toBe('immediate');
  });

  it('unknown source -> fallback email enqueue', () => {
    const ev = fakeEvent({ source_id: 'unknown', severity: 'low' });
    const res = router.route(ev);
    expect(res?.adapter_ids).toEqual(['email-mailchannels']);
  });

  it('severity default mapping: critical/high immediate, else enqueue when no explicit dispatch', () => {
    // empty match rule has no dispatch -> fallback to severity rule in createRouter
    const table = {
      version: '1.0' as const,
      rules: [{ match: {}, adapters: ['email-mailchannels'] }]
    };
    const r = createRouter(table);
    expect(r.route(fakeEvent({ severity: 'critical' }))?.dispatch).toBe('immediate');
    expect(r.route(fakeEvent({ severity: 'high' }))?.dispatch).toBe('immediate');
    expect(r.route(fakeEvent({ severity: 'low' }))?.dispatch).toBe('enqueue');
  });
});
