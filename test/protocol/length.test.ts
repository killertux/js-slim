import { describe, expect, it } from "vitest";

import { encodeLength, MINIMUM_NUMBER_LENGTH } from "../../src/protocol/length.js";

describe("encodeLength", () => {
  it("pads short values to the minimum number of digits", () => {
    expect(MINIMUM_NUMBER_LENGTH).toBe(6);
    expect(encodeLength(0)).toBe("000000:");
    expect(encodeLength(5)).toBe("000005:");
    expect(encodeLength(999_999)).toBe("999999:");
  });

  it("grows beyond six digits (protocol >= 0.4)", () => {
    expect(encodeLength(1_000_000)).toBe("1000000:");
  });

  it("rejects negative, fractional and unsafe values", () => {
    expect(() => encodeLength(-1)).toThrow(RangeError);
    expect(() => encodeLength(1.5)).toThrow(RangeError);
    expect(() => encodeLength(Number.NaN)).toThrow(RangeError);
    expect(() => encodeLength(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
