import type { AdapterConfig, AdapterContext, ChannelAdapter, InternalPushMessage, TransportRequest } from "./types";

const DEFAULT_CONFIG: AdapterConfig = {
  immediateRetries: 1,
  circuitThreshold: 3,
  circuitOpenSec: 60,
};

export class JsonWebhookAdapter implements ChannelAdapter {
  readonly config: AdapterConfig = { ...DEFAULT_CONFIG };

  constructor(public readonly id: string) {}

  async render(message: InternalPushMessage, context: AdapterContext): Promise<Extract<TransportRequest, { transport: "http" }>> {
    const endpoint = context.secrets.endpoint;
    if (!endpoint) throw new Error("Adapter endpoint is required for rendering");

    return {
      transport: "http",
      request: {
        method: "POST",
        url: endpoint,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      },
    };
  }
}
