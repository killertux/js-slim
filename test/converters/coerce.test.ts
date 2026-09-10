import { describe, expect, it } from "vitest";

import { coerceValue, toSlimValue } from "../../src/converters/coerce.js";
import { ConverterRegistry } from "../../src/converters/registry.js";
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
