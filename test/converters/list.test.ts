import { describe, expect, it } from "vitest";

import { ListConverter, parseListString } from "../../src/converters/list.js";

describe("parseListString", () => {
  it("parses bracketed and unbracketed lists", () => {
    expect(parseListString("[1,2,3]")).toEqual(["1", "2", "3"]);
    expect(parseListString("1,2,3")).toEqual(["1", "2", "3"]);
  });

  it("trims items", () => {
    expect(parseListString("1,  2,  3  ")).toEqual(["1", "2", "3"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseListString("[]")).toEqual([]);
    expect(parseListString("")).toEqual([]);
    expect(parseListString(" ")).toEqual([]);
  });

  it("keeps interior empty items", () => {
    expect(parseListString("[1, ,3]")).toEqual(["1", "", "3"]);
  });
});

describe("ListConverter", () => {
  const converter = new ListConverter();

  it("renders a list like Java List#toString", () => {
    expect(converter.toSlim(["a", "b"])).toBe("[a, b]");
    expect(converter.toSlim([])).toBe("[]");
    expect(converter.toSlim(null)).toBeNull();
  });

  it("passes decoded lists through unchanged", () => {
    const value = ["a", "b"];
    expect(converter.fromSlim(value)).toBe(value);
  });

  it("parses the string form", () => {
    expect(converter.fromSlim("[1, 2]")).toEqual(["1", "2"]);
  });
});
