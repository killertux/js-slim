import { describe, expect, it } from "vitest";

import { MapConverter, formatHashTable, parseHashTable } from "../../src/converters/map.js";

const TABLE =
  '<table class="hash_table">' +
  '<tr class="hash_row"><td class="hash_key">a</td><td class="hash_value">b</td></tr>' +
  "</table>";

describe("formatHashTable", () => {
  it("renders the hash-widget table", () => {
    expect(formatHashTable(new Map([["a", "b"]]))).toBe(TABLE);
    expect(formatHashTable(new Map())).toBe('<table class="hash_table"></table>');
  });

  it("escapes cell content", () => {
    expect(formatHashTable(new Map([["<a>", '&"b']]))).toBe(
      '<table class="hash_table"><tr class="hash_row">' +
        '<td class="hash_key">&lt;a&gt;</td><td class="hash_value">&amp;&quot;b</td>' +
        "</tr></table>",
    );
  });

  it("renders null cells as the literal null", () => {
    expect(formatHashTable(new Map([["a", null]]))).toContain('<td class="hash_value">null</td>');
  });

  it("renders list and nested-map cells like Java", () => {
    expect(formatHashTable(new Map([["k", ["b", "c"]]]))).toContain(
      '<td class="hash_value">[b, c]</td>',
    );
    expect(formatHashTable(new Map([["k", new Map([["x", "y"]])]]))).toContain(
      '<table class="hash_table">',
    );
  });
});

describe("parseHashTable", () => {
  it("parses a table back into a map", () => {
    expect(parseHashTable(TABLE)).toEqual(new Map([["a", "b"]]));
  });

  it("tolerates whitespace between tags", () => {
    expect(parseHashTable(TABLE.replaceAll("><", "> <"))).toEqual(new Map([["a", "b"]]));
  });

  it("ignores rows without exactly two cells", () => {
    const html = "<table><tr><td>a</td></tr><tr><td>k</td><td>v</td></tr></table>";
    expect(parseHashTable(html)).toEqual(new Map([["k", "v"]]));
  });

  it("returns null when there is not exactly one table", () => {
    expect(parseHashTable("not a table")).toBeNull();
    expect(
      parseHashTable("<table><tr><td>a</td><td>b</td></tr></table><table></table>"),
    ).toBeNull();
  });

  it("rejects input containing a nested table", () => {
    const html =
      "<table><tr><td>a</td><td><table><tr><td>n</td><td>v</td></tr></table></td></tr></table>";
    expect(parseHashTable(html)).toBeNull();
  });

  it("unescapes cell content", () => {
    const html = "<table><tr><td>&lt;a&gt;</td><td>&amp;&quot;b</td></tr></table>";
    expect(parseHashTable(html)).toEqual(new Map([["<a>", '&"b']]));
  });
});

describe("MapConverter", () => {
  const converter = new MapConverter();

  it("round-trips a map", () => {
    const map = new Map([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(converter.fromSlim(converter.toSlim(map) as string)).toEqual(map);
  });

  it("returns null for blank input and an empty map for invalid input", () => {
    expect(converter.fromSlim("")).toBeNull();
    expect(converter.fromSlim("not a table")).toEqual(new Map());
  });
});
