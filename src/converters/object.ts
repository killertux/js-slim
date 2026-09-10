import type { SlimValue } from "../protocol/types.js";
import { smartCoerce } from "./smart.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

/**
 * Fallback (`object`) conversion.
 *
 * Input is smart-coerced rather than passed through as a string, which is more
 * useful in JavaScript than Java's `DefaultConverter` identity behaviour.
 */
export class ObjectConverter implements Converter<unknown> {
  toSlim(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return slimValueToString(value);
    }
    return String(value);
  }

  fromSlim(value: SlimValue): unknown {
    return smartCoerce(value);
  }
}
