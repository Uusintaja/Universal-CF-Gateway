import type { RawPayload } from "./types";

export const EVENT_ID_LIMITS = {
  MAX_DEPTH: 64,
  MAX_OBJECT_KEYS: 2_048,
  MAX_CANONICAL_BYTES: 512 * 1024,
} as const;

export class EventIdComplexityError extends Error {
  readonly name = "EventIdComplexityError";
}

function assertDepth(depth: number): void {
  if (depth > EVENT_ID_LIMITS.MAX_DEPTH) {
    throw new EventIdComplexityError("JSON exceeds the event_id canonicalization depth limit");
  }
}

function canonicalizeValue(value: unknown, depth: number): string {
  assertDepth(depth);

  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EventIdComplexityError("JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeValue(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length > EVENT_ID_LIMITS.MAX_OBJECT_KEYS) {
      throw new EventIdComplexityError("JSON object exceeds the event_id canonicalization key limit");
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeValue(record[key], depth + 1)}`).join(",")}}`;
  }

  throw new EventIdComplexityError("JSON contains an unsupported value");
}

export function canonicalizeJson(value: unknown): string {
  const result = canonicalizeValue(value, 0);
  if (new TextEncoder().encode(result).byteLength > EVENT_ID_LIMITS.MAX_CANONICAL_BYTES) {
    throw new EventIdComplexityError("JSON exceeds the event_id canonicalization size limit");
  }
  return result;
}

function bytesToUuid(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.slice(0, 16));
  copy[6] = (copy[6] & 0x0f) | 0x40;
  copy[8] = (copy[8] & 0x3f) | 0x80;
  const hex = Array.from(copy, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function sha256Uuid(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return bytesToUuid(new Uint8Array(digest));
}

export async function deriveGatewayEventId(
  sourceId: string,
  parsedPayload: unknown,
  contentType = "application/json",
): Promise<string> {
  const canonical = canonicalizeJson(parsedPayload);
  return sha256Uuid(`${sourceId}\u0000${contentType}\u0000${canonical}`);
}

export async function deriveRawGatewayEventId(
  sourceId: string,
  rawPayload: RawPayload,
): Promise<string> {
  const prefix = new TextEncoder().encode(`${sourceId}\u0000${rawPayload.content_type ?? "application/octet-stream"}\u0000`);
  const input = new Uint8Array(prefix.byteLength + rawPayload.bytes.byteLength);
  input.set(prefix);
  input.set(rawPayload.bytes, prefix.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return bytesToUuid(new Uint8Array(digest));
}
