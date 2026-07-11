import { describe, expect, it } from "vitest";
import { genericJsonDecoder } from "../src/decoder";
import type { RawInput, RequestMeta } from "../src/types";

const meta: RequestMeta = {
  source_id: "github-ci",
  auth_context: null,
  received_at: "2026-07-11T00:00:00.000Z",
  transport: "http",
};

function rawJson(value: unknown): RawInput {
  return {
    body: new TextEncoder().encode(JSON.stringify(value)),
    headers: { "content-type": "application/json" },
    gateway_trace: "gateway-trace-001",
    source_meta: { transport: "http", method: "POST", path: "/hooks/github-ci" },
  };
}

describe("generic JSON decoder", () => {
  it("decodes and preserves the standard event fields", async () => {
    const result = await genericJsonDecoder.decode(rawJson({
      event_id: "123e4567-e89b-12d3-a456-426614174000",
      event_type: "build.failed",
      severity: "high",
      timestamp: "2026-07-11T00:00:00.000Z",
      title: "Build failed",
      body: { commit: "abc" },
      trace: { source_trace: "delivery-123" },
      metadata: { repository: "demo" },
    }), meta);

    expect(result).toMatchObject({
      schema_version: "1.0",
      event_id: "123e4567-e89b-12d3-a456-426614174000",
      source_id: "github-ci",
      event_type: "build.failed",
      severity: "high",
      title: "Build failed",
      trace: { source_trace: "delivery-123", gateway_trace: "gateway-trace-001" },
      auth_context: null,
    });
  });

  it("creates a stable UUID when event_id is absent", async () => {
    const input = rawJson({
      event_type: "build.failed",
      severity: "high",
      title: "Build failed",
      body: { commit: "same" },
    });

    const first = await genericJsonDecoder.decode(input, meta);
    const second = await genericJsonDecoder.decode(input, meta);

    expect(first).toMatchObject({ event_id: expect.any(String) });
    expect(first).toEqual(second);
  });

  it("returns a normalized DecodeError for malformed JSON", async () => {
    const result = await genericJsonDecoder.decode({
      ...rawJson({}),
      body: new TextEncoder().encode("not-json"),
    }, meta);

    expect(result).toEqual({
      code: "MALFORMED",
      message: "Request body must be valid JSON",
      http_status: 400,
    });
  });

  it("returns a normalized error for unsupported severity", async () => {
    const result = await genericJsonDecoder.decode(rawJson({
      event_type: "build.failed",
      severity: "urgent",
      title: "Build failed",
      body: {},
    }), meta);

    expect(result).toMatchObject({ code: "MALFORMED", http_status: 400 });
  });
});
