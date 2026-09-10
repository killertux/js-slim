import { describe, expect, it } from "vitest";

import { deserialize } from "../../src/protocol/deserializer.js";
import { serialize } from "../../src/protocol/serializer.js";

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

  it("stringifies non-string items", () => {
    expect(deserialize(serialize([1]))).toEqual(["1"]);
  });

  it("emits lengths longer than six digits", () => {
    const long = "x".repeat(1_000_000);
    const encoded = serialize([long]);

    expect(encoded.startsWith("[000001:1000000:")).toBe(true);
    expect(deserialize(encoded)).toEqual([long]);
  });

  it("rejects non-array input", () => {
    expect(() => serialize("nope" as unknown as unknown[])).toThrow(TypeError);
  });
});
