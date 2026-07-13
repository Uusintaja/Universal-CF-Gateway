import type { InternalEvent } from '../decoder/types.js';
import type { RouteResult } from '../router/types.js';

export interface QueuePayload {
  event: InternalEvent;
  route: RouteResult;
}
