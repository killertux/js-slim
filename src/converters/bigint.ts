import { SlimError, formatSlimMessage } from "../errors.js";
import type { SlimValue } from "../protocol/types.js";
import { INTEGER_PATTERN } from "./smart.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

/** Arbitrary-precision integer conversion (Java's `long`). */
export class BigIntConverter implements Converter<bigint> {
  toSlim(value: bigint | null | undefined): string | null {
    return value === null || value === undefined ? null : value.toString();
  }

  fromSlim(value: SlimValue): bigint | null {
    const raw = slimValueToString(value);
    const trimmed = raw.trim();
    if (trimmed === "") {
      return null;
    }

    if (!INTEGER_PATTERN.test(trimmed)) {
      throw new SlimError(formatSlimMessage(`Can't convert ${raw} to long.`));
    }
    return BigInt(trimmed);
  }
}
