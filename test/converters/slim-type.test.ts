import { describe, expect, it } from "vitest";

import {
  isListType,
  listOf,
  normalizeSlimType,
  slimTypeName,
} from "../../src/converters/slim-type.js";

describe("listOf / isListType", () => {
  it("builds a list descriptor", () => {
    expect(listOf(Number)).toEqual({ kind: "list", element: Number });
    expect(isListType(listOf(Number))).toBe(true);
  });

  it("only accepts list descriptors", () => {
    expect(isListType(Array)).toBe(false);
    expect(isListType("list")).toBe(false);
    expect(isListType(null)).toBe(false);
    expect(isListType(undefined)).toBe(false);
  });
});

describe("normalizeSlimType", () => {
  it("maps aliases and descriptors onto registry keys", () => {
    expect(normalizeSlimType("list")).toBe(Array);
    expect(normalizeSlimType("map")).toBe(Map);
    expect(normalizeSlimType("object")).toBe(Object);
    expect(normalizeSlimType("void")).toBe("void");
    expect(normalizeSlimType(Number)).toBe(Number);
    expect(normalizeSlimType(listOf(Number))).toBe(Array);
    expect(normalizeSlimType(listOf(listOf(String)))).toBe(Array);
  });
});

describe("slimTypeName", () => {
  it("names constructors, aliases and nested list descriptors", () => {
    expect(slimTypeName(Number)).toBe("Number");
    expect(slimTypeName("list")).toBe("list");
    expect(slimTypeName("void")).toBe("void");
    expect(slimTypeName(listOf(Number))).toBe("list<Number>");
    expect(slimTypeName(listOf(listOf(String)))).toBe("list<list<String>>");
  });
});
