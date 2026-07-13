import { describe, it, expect } from 'vitest';
import { chunkByDualThreshold } from '../../src/queues/chunk.js';
import type { InternalEvent } from '../../src/decoder/types.js';

function fakeEvent(id: string, size = 100): InternalEvent {
  return {
    schema_version: '1.0',
    event_id: id,
    source_id: 'monitor',
    event_type: 'test',
    severity: 'low',
    timestamp: new Date().toISOString(),
    title: `Event ${id}`,
    body: { data: 'x'.repeat(size) },
    trace: { gateway_trace: 'gt' },
    auth_context: null,
    metadata: {}
  } as any;
}

describe('Chunk dual threshold §3.1', () => {
  it('51 items -> 2 chunks (50+1)', () => {
    const events = Array.from({ length: 51 }, (_, i) => fakeEvent(`e${i}`, 10));
    const chunks = chunkByDualThreshold(events, 'email-mailchannels', false);
    expect(chunks.length).toBe(2);
    expect(chunks[0].items.length).toBe(50);
    expect(chunks[1].items.length).toBe(1);
    const total = chunks.reduce((s, c) => s + c.items.length, 0);
    expect(total).toBe(51);
  });

  it('Email limit 12 -> 10+2', () => {
    const events = Array.from({ length: 12 }, (_, i) => fakeEvent(`e${i}`, 10));
    const chunks = chunkByDualThreshold(events, 'email-mailchannels', true);
    expect(chunks.length).toBe(2);
    expect(chunks[0].items.length).toBe(10);
    expect(chunks[1].items.length).toBe(2);
  });

  it('Single item over 24KB alone', () => {
    const big = fakeEvent('big', 25000);
    const chunks = chunkByDualThreshold([big], 'slack-webhook', false);
    expect(chunks.length).toBe(1);
    expect(chunks[0].items[0].event_id).toBe('big');
  });

  it('Empty -> 0 chunks', () => {
    const chunks = chunkByDualThreshold([], 'email', false);
    expect(chunks.length).toBe(0);
  });

  it('Chunk index/total assigned', () => {
    const events = Array.from({ length: 51 }, (_, i) => fakeEvent(`e${i}`, 10));
    const chunks = chunkByDualThreshold(events, 'test', false);
    expect(chunks[0].chunk.total).toBe(2);
    expect(chunks[0].chunk.index).toBe(0);
    expect(chunks[1].chunk.index).toBe(1);
  });
});
