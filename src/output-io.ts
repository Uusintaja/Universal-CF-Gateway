import type { SendError, TransportRequest } from "./types";

export const OUTPUT_IO_LIMITS = {
  TIMEOUT_MS: 5_000,
  IMMEDIATE_RETRIES: 2,
  BACKOFF_MS: 50,
} as const;

type HttpTransportRequest = Extract<TransportRequest, { transport: "http" }>;
type FetchImplementation = typeof fetch;
type SleepImplementation = (milliseconds: number) => Promise<void>;

export interface TransmitHttpOptions {
  fetchImpl?: FetchImplementation;
  sleep?: SleepImplementation;
  timeoutMs?: number;
  immediateRetries?: number;
  backoffMs?: number;
}

export type TransmitHttpResult =
  | { ok: true; status: number; attempts: number }
  | { ok: false; status?: number; attempts: number; error: SendError };

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function classifyStatus(status: number): SendError {
  if (status === 408 || status === 429 || status >= 500) {
    return {
      code: status === 429 ? "RATE_LIMITED" : "UPSTREAM_5XX",
      message: `Upstream returned HTTP ${status}`,
      retryable: true,
      http_status: status,
    };
  }
  return {
    code: "INVALID_MESSAGE",
    message: `Upstream rejected the request with HTTP ${status}`,
    retryable: false,
    http_status: status,
  };
}

function networkError(error: unknown): SendError {
  const message = error instanceof Error && error.name === "AbortError"
    ? "HTTP request timed out"
    : error instanceof Error ? error.message : "HTTP request failed";
  return {
    code: "NETWORK",
    message,
    retryable: true,
  };
}

async function fetchWithTimeout(
  request: HttpTransportRequest["request"],
  fetchImpl: FetchImplementation,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function transmitHttp(
  transport: HttpTransportRequest,
  options: TransmitHttpOptions = {},
): Promise<TransmitHttpResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleep ?? sleep;
  const timeoutMs = options.timeoutMs ?? OUTPUT_IO_LIMITS.TIMEOUT_MS;
  const retries = options.immediateRetries ?? OUTPUT_IO_LIMITS.IMMEDIATE_RETRIES;
  const backoffMs = options.backoffMs ?? OUTPUT_IO_LIMITS.BACKOFF_MS;
  const maxAttempts = Math.max(1, retries + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(transport.request, fetchImpl, timeoutMs);
      // Always consume the body so the connection can be reused safely.
      await response.text();

      if (response.ok) return { ok: true, status: response.status, attempts: attempt };

      const error = classifyStatus(response.status);
      if (!error.retryable || attempt === maxAttempts) {
        return { ok: false, status: response.status, attempts: attempt, error };
      }
      await sleepImpl(backoffMs * 2 ** (attempt - 1));
    } catch (error) {
      const sendError = networkError(error);
      if (attempt === maxAttempts) return { ok: false, attempts: attempt, error: sendError };
      await sleepImpl(backoffMs * 2 ** (attempt - 1));
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    error: { code: "UNKNOWN", message: "HTTP transmit loop ended unexpectedly", retryable: false },
  };
}
