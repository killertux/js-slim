import { describe, expect, it } from "vitest";

import { coerceArgument, coerceValue, toSlimValue } from "../../src/converters/coerce.js";
import { ConverterRegistry } from "../../src/converters/registry.js";
import { listOf } from "../../src/converters/slim-type.js";
import { smartCoerce } from "../../src/converters/smart.js";
import type { Converter } from "../../src/converters/types.js";
import { VOID_TAG } from "../../src/converters/void.js";

class MarkerDateConverter implements Converter<Date> {
  toSlim(): string {
    return "custom-date";
  }

  fromSlim(): Date {
    return new Date(0);
  }
}

describe("smartCoerce", () => {
  it("coerces boolean literals", () => {
    expect(smartCoerce("true")).toBe(true);
    expect(smartCoerce("FALSE")).toBe(false);
  });

  it("leaves yes and no as strings", () => {
    expect(smartCoerce("yes")).toBe("yes");
    expect(smartCoerce("no")).toBe("no");
  });

  it("coerces numeric literals", () => {
    expect(smartCoerce("42")).toBe(42);
    expect(smartCoerce("-0.50")).toBe(-0.5);
    expect(smartCoerce("1e3")).toBe(1000);
    expect(smartCoerce("007")).toBe(7);
    expect(smartCoerce(".5")).toBe(0.5);
  });

  it("keeps integers that would lose precision as strings", () => {
    expect(smartCoerce("99999999999999999999")).toBe("99999999999999999999");
  });

  it("leaves other strings alone", () => {
    expect(smartCoerce("foo")).toBe("foo");
    expect(smartCoerce("null")).toBe("null");
    expect(smartCoerce("")).toBe("");
    expect(smartCoerce(" 42 ")).toBe(" 42 ");
    expect(smartCoerce("Infinity")).toBe("Infinity");
    expect(smartCoerce("05-May-2009")).toBe("05-May-2009");
  });

  it("keeps overflow and underflow literals as strings", () => {
    expect(smartCoerce("1e400")).toBe("1e400");
    expect(smartCoerce("1e-400")).toBe("1e-400");
    expect(smartCoerce("0")).toBe(0);
    expect(smartCoerce("0.0")).toBe(0);
  });

  it("returns lists as-is", () => {
    const list = ["a", "b"];
    expect(smartCoerce(list)).toBe(list);
  });
});

describe("coerceValue", () => {
  it("smart-coerces when no type is declared", () => {
    expect(coerceValue("42")).toBe(42);
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("foo")).toBe("foo");
  });

  it("uses the declared converter", () => {
    expect(coerceValue("42", String)).toBe("42");
    expect(coerceValue("42", Number)).toBe(42);
    expect(coerceValue("yes", Boolean)).toBe(true);
    expect(coerceValue("05-May-2009", Date)).toEqual(new Date(Date.UTC(2009, 4, 5)));
    expect(coerceValue("[1, 2]", Array)).toEqual(["1", "2"]);
    expect(coerceValue("<table><tr><td>a</td><td>b</td></tr></table>", Map)).toEqual(
      new Map([["a", "b"]]),
    );
  });

  it("throws with the Java message when no converter is registered", () => {
    expect(() => coerceValue("x", "unknown" as never)).toThrow(
      "message:<<NO_CONVERTER_FOR_ARGUMENT_NUMBER unknown.>>",
    );
  });

  it("converts to void", () => {
    expect(coerceValue("anything", "void")).toBeNull();
  });
});

describe("toSlimValue", () => {
  it("maps values onto the wire model", () => {
    expect(toSlimValue(undefined)).toBe(VOID_TAG);
    expect(toSlimValue(null)).toBeNull();
    expect(toSlimValue("x")).toBe("x");
    expect(toSlimValue(3.5)).toBe("3.5");
    expect(toSlimValue(true)).toBe("true");
    expect(toSlimValue(10n)).toBe("10");
    expect(toSlimValue(new Date(Date.UTC(2009, 4, 5)))).toBe("05-May-2009");
  });

  it("renders arrays recursively", () => {
    expect(toSlimValue(["a", 1, ["b"]])).toEqual(["a", "1", ["b"]]);
  });

  it("renders maps as hash tables", () => {
    expect(toSlimValue(new Map([["a", "b"]]))).toBe(
      '<table class="hash_table">' +
        '<tr class="hash_row"><td class="hash_key">a</td><td class="hash_value">b</td></tr>' +
        "</table>",
    );
  });

  it("stringifies other objects via their toString", () => {
    expect(toSlimValue({ toString: () => "custom object" })).toBe("custom object");
  });

  it("renders non-finite numbers like Java", () => {
    expect(toSlimValue(Number.NaN)).toBe("NaN");
    expect(toSlimValue(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("prefers the declared type's converter", () => {
    const registry = new ConverterRegistry();
    registry.register(Date, new MarkerDateConverter());

    expect(toSlimValue(new Date(Date.UTC(2009, 4, 5)), Date, registry)).toBe("custom-date");
  });
});

describe("declared collection aliases", () => {
  const TABLE = "<table><tr><td>a</td><td>b</td></tr></table>";

  it("treats the string aliases like their constructors", () => {
    expect(coerceValue("[1, 2]", "list")).toEqual(coerceValue("[1, 2]", Array));
    expect(coerceValue(TABLE, "map")).toEqual(coerceValue(TABLE, Map));
    expect(coerceValue("42", "object")).toBe(42);
    expect(coerceValue("anything", "void")).toBeNull();
  });
});

describe("listOf element types", () => {
  it("converts each element with the declared element type", () => {
    expect(coerceValue("1,2,3", listOf(Number))).toEqual([1, 2, 3]);
    expect(coerceValue("[a, b]", listOf(String))).toEqual(["a", "b"]);
    expect(coerceValue("true,false", listOf(Boolean))).toEqual([true, false]);
    expect(coerceValue("05-May-2009", listOf(Date))).toEqual([new Date(Date.UTC(2009, 4, 5))]);
  });

  it("handles a decoded nested list", () => {
    expect(coerceValue([["1", "2"], ["3"]], listOf(listOf(Number)))).toEqual([[1, 2], [3]]);
  });

  it("returns null for a blank list", () => {
    expect(coerceValue("", listOf(Number))).toBeNull();
  });

  it("leaves an untyped list as raw SLiM strings", () => {
    expect(coerceValue("1,2", Array)).toEqual(["1", "2"]);
    expect(coerceValue("1,2", "list")).toEqual(["1", "2"]);
  });

  it("raises NO_CONVERTER_FOR_ARGUMENT_NUMBER when the list converter is missing", () => {
    const registry = new ConverterRegistry();
    registry.remove(Array);

    expect(() => coerceValue("1,2", listOf(Number), registry)).toThrow(
      /NO_CONVERTER_FOR_ARGUMENT_NUMBER/,
    );
  });

  it("renders elements with the declared type", () => {
    expect(toSlimValue([1, 2, 3], listOf(Number))).toEqual(["1", "2", "3"]);
    expect(toSlimValue([new Date(Date.UTC(2009, 4, 5))], listOf(Date))).toEqual(["05-May-2009"]);
    expect(toSlimValue([1, 2], Array)).toEqual(["1", "2"]);
  });
});

describe("malformed type declarations", () => {
  it("rejects a list descriptor with no element type", () => {
    expect(() => coerceValue("1,2", { kind: "list" } as never)).toThrow(
      /NO_CONVERTER_FOR_ARGUMENT_NUMBER/,
    );
  });
});

describe("coerceArgument with declared types", () => {
  it("passes a symbol value that already has the declared type", () => {
    const date = new Date(Date.UTC(2009, 4, 5));
    const map = new Map([["a", "b"]]);
    const object = { x: 1 };

    expect(coerceArgument(5, Number)).toBe(5);
    expect(coerceArgument("x", String)).toBe("x");
    expect(coerceArgument(true, Boolean)).toBe(true);
    expect(coerceArgument(5n, BigInt)).toBe(5n);
    expect(coerceArgument(date, Date)).toBe(date);
    expect(coerceArgument(map, Map)).toBe(map);
    expect(coerceArgument(object, Object)).toBe(object);
  });

  it("stringifies a symbol value of another type", () => {
    expect(coerceArgument(5, String)).toBe("5");
    expect(coerceArgument("5", Number)).toBe(5);
    expect(coerceArgument(0, String)).toBe("0");
    expect(coerceArgument(null, Number)).toBeNull();
    expect(coerceArgument(undefined, Number)).toBeNull();
    // A scalar symbol can still fill a collection or void parameter.
    expect(coerceArgument(5, listOf(Number))).toEqual([5]);
    expect(coerceArgument(5, "list")).toEqual(["5"]);
    expect(coerceArgument(5, "void")).toBeNull();
  });

  it("converts a symbol holding a list of numbers", () => {
    expect(coerceArgument([1, 2, 3], listOf(Number))).toEqual([1, 2, 3]);
    expect(coerceArgument([[1, 2], [3]], listOf(listOf(Number)))).toEqual([[1, 2], [3]]);
    // Mixed elements take whichever path applies to each one.
    expect(coerceArgument(["1", 2], listOf(Number))).toEqual([1, 2]);
  });

  it("leaves an undeclared symbol value alone", () => {
    expect(coerceArgument(5)).toBe(5);
    expect(coerceArgument(new Date(0))).toBeInstanceOf(Date);
    expect(coerceArgument("42")).toBe(42);
    expect(coerceArgument("42", "void")).toBeNull();
  });
});
