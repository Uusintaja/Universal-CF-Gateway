import { describe, expect, it, vi } from "vitest";
import { transmitHttp } from "../src/output-io";
import type { TransportRequest } from "../src/types";

const request: Extract<TransportRequest, { transport: "http" }> = {
  transport: "http",
  request: {
    method: "POST",
    url: "https://channel.invalid/hook",
    headers: { "content-type": "application/json" },
    body: '{"hello":"phase1"}',
  },
};

describe("output I/O layer", () => {
  it("sends a successful HTTP request and consumes the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("accepted", { status: 202 }));

    const result = await transmitHttp(request, { fetchImpl });

    expect(result).toEqual({ ok: true, status: 202, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and succeeds within the attempt budget", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("accepted", { status: 200 }));

    const result = await transmitHttp(request, {
      fetchImpl,
      immediateRetries: 2,
      backoffMs: 0,
    });

    expect(result).toEqual({ ok: true, status: 200, attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry an ordinary 4xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad request", { status: 400 }));

    const result = await transmitHttp(request, { fetchImpl, immediateRetries: 2 });

    expect(result).toMatchObject({
      ok: false,
      attempts: 1,
      status: 400,
      error: { code: "INVALID_MESSAGE", retryable: false },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx response only up to the configured limit", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));

    const result = await transmitHttp(request, {
      fetchImpl,
      immediateRetries: 2,
      backoffMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      attempts: 3,
      status: 503,
      error: { code: "UPSTREAM_5XX", retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("aborts a fetch that exceeds the timeout", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    const result = await transmitHttp(request, {
      fetchImpl,
      timeoutMs: 1,
      immediateRetries: 0,
      backoffMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      attempts: 1,
      error: { code: "NETWORK", retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("converts a network exception into a bounded retryable error", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("socket closed"); });

    const result = await transmitHttp(request, {
      fetchImpl,
      immediateRetries: 2,
      backoffMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      attempts: 3,
      error: { code: "NETWORK", retryable: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
