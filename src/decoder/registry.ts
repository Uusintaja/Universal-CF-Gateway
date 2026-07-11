import type { DecoderRegistry } from './types.js';
import { genericJsonDecoder } from './generic.js';

export const DECODER_REGISTRY: DecoderRegistry = {
  'generic-json': genericJsonDecoder,
  // source_id -> decoder mapping, for Phase 0 all sources use generic
  'github-ci': genericJsonDecoder,
  'monitor': genericJsonDecoder
};

export function getDecoder(sourceId: string) {
  return DECODER_REGISTRY[sourceId] ?? DECODER_REGISTRY['generic-json'];
}
