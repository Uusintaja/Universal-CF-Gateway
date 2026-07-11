import { emailAdapter } from './email.js';
import { httpAdapter, webhookSiteAdapter } from './http.js';
import type { AdapterRegistry } from './types.js';

export const ADAPTER_REGISTRY: AdapterRegistry = {
  'email-mailchannels': emailAdapter,
  'slack-webhook': httpAdapter,
  'webhook-site': webhookSiteAdapter
};
