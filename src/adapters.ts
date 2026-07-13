import { encodeBase64 } from "./queue";
import type { AdapterConfig, AdapterContext, ChannelAdapter, InternalPushMessage, TransportRequest } from "./types";

const DEFAULT_CONFIG: AdapterConfig = {
  immediateRetries: 1,
  circuitThreshold: 3,
  circuitOpenSec: 60,
};

export class JsonWebhookAdapter implements ChannelAdapter {
  readonly config: AdapterConfig = { ...DEFAULT_CONFIG };
  readonly supportsBatch = false;

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

export class AlphaBatchWebhookAdapter implements ChannelAdapter {
  readonly id = "alpha-batch-webhook";
  readonly config: AdapterConfig = { ...DEFAULT_CONFIG };
  readonly supportsBatch = true;

  constructor(private readonly endpointKey = "endpoint") {}

  async render(message: InternalPushMessage, context: AdapterContext): Promise<Extract<TransportRequest, { transport: "http" }>> {
    return this.renderBatch(message, context);
  }

  async renderBatch(message: InternalPushMessage, context: AdapterContext): Promise<Extract<TransportRequest, { transport: "http" }>> {
    const endpoint = context.secrets[this.endpointKey];
    if (!endpoint) throw new Error("Adapter endpoint is required for batch rendering");

    const items = message.items.map((item) => ({
      event_id: item.event_id,
      title: item.title,
      severity: item.severity,
      timestamp: item.timestamp,
      trace: item.trace,
      raw_payload: {
        encoding: "base64" as const,
        bytes: encodeBase64(item.raw_payload.bytes),
        content_type: item.raw_payload.content_type,
      },
    }));

    return {
      transport: "http",
      request: {
        method: "POST",
        url: endpoint,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "1.0",
          adapter: this.id,
          items,
          chunk: message.chunk,
        }),
      },
    };
  }
}
