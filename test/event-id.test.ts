import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  deriveGatewayEventId,
  EventIdComplexityError,
} from "../src/event-id";

describe("I/O event_id derivation", () => {
  it("canonicalizes object keys recursively while preserving array order", () => {
    expect(canonicalizeJson({ b: 2, a: { d: true, c: [2, 1] } })).toBe('{"a":{"c":[2,1],"d":true},"b":2}');
  });

  it("generates the same event_id for semantically equivalent object key order", async () => {
    const first = await deriveGatewayEventId("phase1-test", { a: 1, b: { x: true, y: [1, 2] } });
    const second = await deriveGatewayEventId("phase1-test", { b: { y: [1, 2], x: true }, a: 1 });

    expect(first).toBe(second);
  });

  it("keeps array order semantically significant", async () => {
    const first = await deriveGatewayEventId("phase1-test", { values: [1, 2] });
    const second = await deriveGatewayEventId("phase1-test", { values: [2, 1] });

    expect(first).not.toBe(second);
  });

  it("rejects excessive object complexity instead of silently changing ID strategy", () => {
    const tooWide = Object.fromEntries(Array.from({ length: 2049 }, (_, index) => [`key-${index}`, index]));

    expect(() => canonicalizeJson(tooWide)).toThrow(EventIdComplexityError);
  });
});
