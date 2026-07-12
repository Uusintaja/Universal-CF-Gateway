import { describe, expect, it } from "vitest";
import { INPUT_IO_LIMITS, InputIoError, materializeHttp } from "../src/io";

describe("input I/O layer", () => {
  it("materializes a request body and normalizes headers", async () => {
    const request = new Request("https://gateway.test/incoming", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Header": "present",
      },
      body: '{"hello":"world"}',
    });

    const raw = await materializeHttp(request, { gatewayTrace: "trace-test-001" });

    expect(new TextDecoder().decode(raw.raw_payload.bytes)).toBe('{"hello":"world"}');
    expect(raw.raw_payload.content_type).toBe("application/json");
    expect(raw.gateway_trace).toBe("trace-test-001");
    expect(raw.headers["content-type"]).toBe("application/json");
    expect(raw.headers["x-test-header"]).toBe("present");
    expect(raw.source_meta).toEqual({
      transport: "http",
      method: "POST",
      path: "/incoming",
    });
  });

  it("rejects bodies over the materialization limit", async () => {
    const oversizedBody = "x".repeat(INPUT_IO_LIMITS.MAX_BODY_BYTES + 1);
    const request = new Request("https://gateway.test/incoming", {
      method: "POST",
      body: oversizedBody,
    });

    await expect(materializeHttp(request, { gatewayTrace: "trace-too-large" })).rejects.toBeInstanceOf(InputIoError);
    await expect(materializeHttp(new Request("https://gateway.test/incoming", { method: "POST", body: oversizedBody }), { gatewayTrace: "trace-too-large-2" })).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      httpStatus: 413,
    });
  });
});
