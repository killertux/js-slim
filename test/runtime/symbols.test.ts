import { describe, expect, it } from "vitest";

import {
  isSymbolAssignment,
  substituteSymbols,
  type SymbolResolver,
} from "../../src/runtime/symbols.js";

function resolver(values: Record<string, string>): SymbolResolver {
  return (name) => values[name] ?? null;
}

describe("isSymbolAssignment", () => {
  it("recognises the $name = syntax", () => {
    expect(isSymbolAssignment("$x =")).toBe("x");
    expect(isSymbolAssignment("  $x  =  ")).toBe("x");
    expect(isSymbolAssignment("$café =")).toBe("café");
  });

  it("rejects anything else", () => {
    expect(isSymbolAssignment("$x=1")).toBeNull();
    expect(isSymbolAssignment("$ x =")).toBeNull();
    expect(isSymbolAssignment("x =")).toBeNull();
    expect(isSymbolAssignment("")).toBeNull();
    expect(isSymbolAssignment(null)).toBeNull();
    expect(isSymbolAssignment(undefined)).toBeNull();
  });
});

describe("substituteSymbols", () => {
  it("replaces a single symbol", () => {
    expect(substituteSymbols("hi $name", resolver({ name: "Bob" }))).toBe("hi Bob");
  });

  it("replaces multiple symbols", () => {
    expect(substituteSymbols("$a and $b", resolver({ a: "1", b: "2" }))).toBe("1 and 2");
  });

  it("leaves undefined symbols untouched", () => {
    expect(substituteSymbols("hi $unknown", resolver({}))).toBe("hi $unknown");
  });

  it("falls back to the longest resolvable prefix", () => {
    expect(substituteSymbols("$v1", resolver({ v: "Bob" }))).toBe("Bob1");
    expect(substituteSymbols("$v $v1", resolver({ v: "Bob", v1: "Martin" }))).toBe("Bob Martin");
  });

  it("does not re-substitute symbols introduced by a replacement", () => {
    expect(substituteSymbols("x$v", resolver({ v: "$other", other: "boom" }))).toBe("x$other");
  });

  it("handles adjacent symbols", () => {
    expect(substituteSymbols("$a$b", resolver({ a: "1", b: "2" }))).toBe("12");
  });

  it("supports the backtick expression form", () => {
    expect(substituteSymbols("$`1+1`", resolver({ "`1+1`": "2" }))).toBe("2");
  });

  it("ignores things that only look like symbols", () => {
    expect(substituteSymbols("$", resolver({}))).toBe("$");
    expect(substituteSymbols("$1abc", resolver({}))).toBe("$1abc");
    expect(substituteSymbols("100$", resolver({}))).toBe("100$");
  });

  it("returns assignments unchanged", () => {
    expect(substituteSymbols("$x =", resolver({ x: "1" }))).toBe("$x =");
  });
});
