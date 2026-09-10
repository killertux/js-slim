import { describe, expect, it } from "vitest";

import { deserialize } from "../../src/protocol/deserializer.js";
import { serialize } from "../../src/protocol/serializer.js";
import type { SlimSerializable } from "../../src/protocol/types.js";

// Ported from fitnesse.slim.protocol.SlimSerializerTest.
describe("serialize", () => {
  it("serializes an empty list", () => {
    expect(serialize([])).toBe("[000000:]");
  });

  it("serializes a one-item list", () => {
    expect(serialize(["hello"])).toBe("[000001:000005:hello:]");
  });

  it("serializes a two-item list", () => {
    expect(serialize(["hello", "world"])).toBe("[000002:000005:hello:000005:world:]");
  });

  it("counts a surrogate pair as two UTF-16 code units", () => {
    expect("h🀜llo".length).toBe(6);
    expect(serialize(["h🀜llo", "world"])).toBe("[000002:000006:h🀜llo:000005:world:]");
  });

  it("serializes a nested list", () => {
    expect(serialize([["element"]])).toBe("[000001:000024:[000001:000007:element:]:]");
  });

  it("serializes null as the literal string null", () => {
    expect(serialize([null])).toBe("[000001:000004:null:]");
  });

  it("serializes undefined as the literal string null", () => {
    expect(serialize([undefined])).toBe("[000001:000004:null:]");
  });

  it("serializes an empty string item", () => {
    expect(serialize([""])).toBe("[000001:000000::]");
  });

  it("stringifies numbers and booleans", () => {
    expect(serialize([1, true])).toBe("[000002:000001:1:000004:true:]");
    expect(deserialize(serialize([1]))).toEqual(["1"]);
  });

  it("emits lengths longer than six digits", () => {
    const long = "x".repeat(1_000_000);
    const encoded = serialize([long]);

    expect(encoded.startsWith("[000001:1000000:")).toBe(true);
    expect(deserialize(encoded)).toEqual([long]);
  });

  it("rejects non-array input", () => {
    expect(() => serialize("nope" as unknown as readonly SlimSerializable[])).toThrow(TypeError);
  });
});
