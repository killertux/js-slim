import { describe, expect, it } from "vitest";

import { BigIntConverter } from "../../src/converters/bigint.js";
import { BooleanConverter } from "../../src/converters/boolean.js";
import { DateConverter, formatDate, parseDate } from "../../src/converters/date.js";
import { NumberConverter } from "../../src/converters/number.js";
import { StringConverter, slimValueToString } from "../../src/converters/string.js";
import { VOID_TAG, VoidConverter } from "../../src/converters/void.js";
import type { Converter } from "../../src/converters/types.js";
import { SlimError } from "../../src/errors.js";

describe("StringConverter", () => {
  const converter = new StringConverter();

  it("returns null for null and undefined", () => {
    expect(converter.toSlim(null)).toBeNull();
    expect(converter.toSlim(undefined)).toBeNull();
  });

  it("passes strings through, including the empty string", () => {
    expect(converter.toSlim("x")).toBe("x");
    expect(converter.fromSlim("x")).toBe("x");
    expect(converter.fromSlim("")).toBe("");
  });

  it("renders lists like Java List#toString", () => {
    expect(converter.fromSlim(["a", "b"])).toBe("[a, b]");
  });

  it("renders null and undefined values as the literal null", () => {
    expect(slimValueToString(null)).toBe("null");
    expect(slimValueToString(undefined)).toBe("null");
  });
});

describe("NumberConverter", () => {
  const converter = new NumberConverter();

  it("formats and parses numbers", () => {
    expect(converter.toSlim(3.5)).toBe("3.5");
    expect(converter.toSlim(null)).toBeNull();
    expect(converter.fromSlim("31415962")).toBe(31_415_962);
    expect(converter.fromSlim("1.5")).toBe(1.5);
  });

  it("treats blank input as null", () => {
    expect(converter.fromSlim("")).toBeNull();
    expect(converter.fromSlim("  ")).toBeNull();
  });

  it("reports a conversion failure", () => {
    expect(() => converter.fromSlim("foo")).toThrow("message:<<Can't convert foo to number.>>");
  });

  it("rejects non-decimal literals", () => {
    expect(() => converter.fromSlim("0x10")).toThrow(SlimError);
    expect(() => converter.fromSlim("Infinity")).toThrow(SlimError);
  });
});

describe("BigIntConverter", () => {
  const converter = new BigIntConverter();

  it("formats and parses big integers", () => {
    expect(converter.toSlim(10n)).toBe("10");
    expect(converter.fromSlim("31415962")).toBe(31_415_962n);
    expect(converter.fromSlim("99999999999999999999")).toBe(99_999_999_999_999_999_999n);
  });

  it("treats blank input as null", () => {
    expect(converter.fromSlim("")).toBeNull();
  });

  it("reports a conversion failure", () => {
    expect(() => converter.fromSlim("foo")).toThrow("message:<<Can't convert foo to long.>>");
    expect(() => converter.fromSlim("1.5")).toThrow(SlimError);
    expect(() => converter.fromSlim("0x10")).toThrow(SlimError);
  });
});

describe("BooleanConverter", () => {
  const converter = new BooleanConverter();

  it("renders true and false", () => {
    expect(converter.toSlim(true)).toBe("true");
    expect(converter.toSlim(false)).toBe("false");
    expect(converter.toSlim(null)).toBeNull();
  });

  it("parses true and yes as true and everything else as false", () => {
    for (const value of ["true", "TRUE", "yes", "Yes"]) {
      expect(converter.fromSlim(value)).toBe(true);
    }
    for (const value of ["false", "NO", "x", "0"]) {
      expect(converter.fromSlim(value)).toBe(false);
    }
  });

  it("treats blank input as null", () => {
    expect(converter.fromSlim("")).toBeNull();
  });
});

describe("DateConverter", () => {
  const converter = new DateConverter();
  const may5 = new Date(Date.UTC(2009, 4, 5));

  it("formats as dd-MMM-yyyy", () => {
    expect(formatDate(may5)).toBe("05-May-2009");
    expect(converter.toSlim(may5)).toBe("05-May-2009");
    expect(converter.toSlim(null)).toBeNull();
  });

  it("parses with and without a leading zero", () => {
    expect(converter.fromSlim("05-May-2009")).toEqual(may5);
    expect(converter.fromSlim("5-May-2009")).toEqual(may5);
    expect(parseDate("5-May-2009")).toEqual(may5);
    expect(parseDate("nonsense")).toBeNull();
  });

  it("treats blank input as null", () => {
    expect(converter.fromSlim("")).toBeNull();
  });

  it("reports a conversion failure", () => {
    expect(() => converter.fromSlim("foo")).toThrow("message:<<Can't convert foo to date.>>");
    expect(() => converter.fromSlim("32-Xxx-2009")).toThrow(SlimError);
  });
});

describe("VoidConverter", () => {
  const converter = new VoidConverter();

  it("renders the void tag and ignores input", () => {
    expect(VOID_TAG).toBe("/__VOID__/");
    expect(converter.toSlim()).toBe("/__VOID__/");

    const asConverter: Converter<void> = converter;
    expect(asConverter.fromSlim("anything")).toBeNull();
  });
});
