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
    const rawPayload = message.items[0]?.raw_payload;
    if (!endpoint) throw new Error("Adapter endpoint is required for rendering");
    if (!rawPayload) throw new Error("Raw payload is required for the Phase 1 test adapter");

    return {
      transport: "http",
      request: {
        method: "POST",
        url: endpoint,
        headers: { "content-type": rawPayload.content_type ?? "application/octet-stream" },
        body: rawPayload.bytes,
      },
    };
  }
}
