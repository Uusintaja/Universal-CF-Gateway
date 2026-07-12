import type { RawInput } from "./types";

export const INPUT_IO_LIMITS = {
  MAX_BODY_BYTES: 512 * 1024,
  READ_TIMEOUT_MS: 2_000,
} as const;

export type InputIoErrorCode = "BODY_TOO_LARGE" | "READ_TIMEOUT" | "READ_FAILED";

export class InputIoError extends Error {
  readonly name = "InputIoError";

  constructor(
    readonly code: InputIoErrorCode,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

export interface MaterializeHttpOptions {
  gatewayTrace?: string;
  readTimeoutMs?: number;
}

function createGatewayTrace(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new Error("crypto.randomUUID is required to create gateway_trace");
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new InputIoError("READ_TIMEOUT", "Request body read timed out", 408)), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof InputIoError) throw error;
    throw new InputIoError("READ_FAILED", "Request body could not be read", 400);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function materializeBody(body: ReadableStream<Uint8Array> | null, timeoutMs: number): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const result = await readChunk(reader, timeoutMs);
      if (result.done) break;

      total += result.value.byteLength;
      if (total > INPUT_IO_LIMITS.MAX_BODY_BYTES) {
        await reader.cancel("body too large");
        throw new InputIoError("BODY_TOO_LARGE", "Request body exceeds the 512 KiB limit", 413);
      }
      chunks.push(result.value);
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* best-effort cancellation */ }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bodyBytes;
}

export async function materializeHttp(
  request: Request,
  options: MaterializeHttpOptions = {},
): Promise<RawInput> {
  const url = new URL(request.url);
  const body = await materializeBody(request.body, options.readTimeoutMs ?? INPUT_IO_LIMITS.READ_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

  return {
    raw_payload: {
      bytes: body,
      content_type: headers["content-type"],
    },
    headers,
    gateway_trace: options.gatewayTrace ?? createGatewayTrace(),
    source_meta: {
      transport: "http",
      method: request.method,
      path: url.pathname,
    },
  };
}
