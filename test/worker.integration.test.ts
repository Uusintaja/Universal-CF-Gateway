import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Worker route boundaries", () => {
  it("does not silently send a multi-adapter route before Phase 2", async () => {
    const response = await SELF.fetch("https://gateway.test/hooks/github-ci", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-source": "github-ci",
      },
      body: JSON.stringify({
        event_type: "build.failed",
        severity: "high",
        event_id: "123e4567-e89b-12d3-a456-426614174000",
        title: "Build failed",
        body: { commit: "abc" },
      }),
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({ error: "ADAPTER_NOT_IMPLEMENTED" });
  });

  it("rejects a webhook without a source selector before decoding", async () => {
    const response = await SELF.fetch("https://gateway.test/hooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "heartbeat", severity: "info", title: "No source", body: {} }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "SOURCE_REQUIRED" });
  });
});
