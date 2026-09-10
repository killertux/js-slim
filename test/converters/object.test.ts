import { describe, expect, it } from "vitest";

import { ObjectConverter } from "../../src/converters/object.js";

describe("ObjectConverter", () => {
  const converter = new ObjectConverter();

  it("smart-coerces input", () => {
    expect(converter.fromSlim("42")).toBe(42);
    expect(converter.fromSlim("true")).toBe(true);
    expect(converter.fromSlim("foo")).toBe("foo");
    expect(converter.fromSlim(["a", "b"])).toBeInstanceOf(Array);
  });

  it("renders values as strings", () => {
    expect(converter.toSlim(null)).toBeNull();
    expect(converter.toSlim(undefined)).toBeNull();
    expect(converter.toSlim("x")).toBe("x");
    expect(converter.toSlim(1)).toBe("1");
    expect(converter.toSlim(true)).toBe("true");
    expect(converter.toSlim(2n)).toBe("2");
    expect(converter.toSlim(["a", "b"])).toBe("[a, b]");
    expect(converter.toSlim({ toString: () => "obj" })).toBe("obj");
  });
});
