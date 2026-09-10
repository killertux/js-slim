import { describe, expect, it } from "vitest";

import { deserialize } from "../../src/protocol/deserializer.js";
import { SlimSyntaxError } from "../../src/protocol/errors.js";
import { serialize } from "../../src/protocol/serializer.js";
import type { SlimList } from "../../src/protocol/types.js";

function roundTrip(list: SlimList): SlimList {
  return deserialize(serialize(list));
}

// Ported from fitnesse.slim.protocol.SlimDeserializerTest.
describe("deserialize", () => {
  it("rejects null", () => {
    expect(() => deserialize(null as unknown as string)).toThrow(SlimSyntaxError);
  });

  it("rejects an empty string", () => {
    expect(() => deserialize("")).toThrow(SlimSyntaxError);
  });

  it("rejects a string without a leading bracket", () => {
    expect(() => deserialize("hello")).toThrow(SlimSyntaxError);
  });

  it("rejects a string without a closing bracket", () => {
    expect(() => deserialize("[000000:")).toThrow(SlimSyntaxError);
  });

  it("rejects a non-string input", () => {
    expect(() => deserialize(42 as unknown as string)).toThrow(SlimSyntaxError);
  });

  it("rejects a declared string length that overruns the input", () => {
    expect(() => deserialize("[000001:000005:hi:]")).toThrow(SlimSyntaxError);
  });

  it("rejects a declared item count that overruns the input", () => {
    expect(() => deserialize("[000002:000005:hello:]")).toThrow(SlimSyntaxError);
  });

  it("rejects a non-numeric length prefix", () => {
    expect(() => deserialize("[00000x:000005:hello:]")).toThrow(SlimSyntaxError);
  });

  it("round-trips an empty list", () => {
    expect(roundTrip([])).toEqual([]);
  });

  it("round-trips one element", () => {
    expect(roundTrip(["hello"])).toEqual(["hello"]);
  });

  it("round-trips two elements", () => {
    expect(roundTrip(["hello", "world"])).toEqual(["hello", "world"]);
  });

  it("round-trips a surrogate pair", () => {
    expect(roundTrip(["h🀜llo", "world"])).toEqual(["h🀜llo", "world"]);
  });

  it("round-trips a sublist", () => {
    expect(roundTrip([["hello", "world"], "single"])).toEqual([["hello", "world"], "single"]);
  });

  it("round-trips deep nesting", () => {
    const list: SlimList = [[[["deep"]]]];
    expect(roundTrip(list)).toEqual(list);
  });

  it("keeps an item containing brackets as a plain string", () => {
    expect(roundTrip(["hello", "[world, world2]"])).toEqual(["hello", "[world, world2]"]);
  });

  it("decodes lengths that grow beyond six digits", () => {
    // "0000010:" is a seven-character prefix that encodes 10.
    expect(deserialize("[000001:0000010:hellohello:]")).toEqual(["hellohello"]);
  });

  it("decodes the documented wire example", () => {
    // "[hello,world]" serializes to this payload (its 35-byte frame is added
    // by the transport, see step 3).
    expect(deserialize("[000002:000005:hello:000005:world:]")).toEqual(["hello", "world"]);
  });

  it("encodes null as the literal string null and does not restore it", () => {
    expect(serialize([null])).toBe("[000001:000004:null:]");
    expect(roundTrip([null])).toEqual(["null"]);
  });

  it("ignores trailing content after the top-level list (Java parity)", () => {
    expect(deserialize("[000000:]trailing")).toEqual([]);
  });
});
