import type { SlimValue } from "../protocol/types.js";

/** Numeric literal syntax accepted by smart coercion. */
const NUMERIC_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Boolean literals recognised by smart coercion (`yes`/`no` stay strings). */
const BOOLEAN_LITERAL = /^(true|false)$/i;

/**
 * Default conversion for an un-annotated argument.
 *
 * - `true`/`false` (case-insensitive) become booleans; `yes`/`no` stay strings.
 * - Numeric literals become numbers unless that would lose integer precision
 *   (bigger than `Number.MAX_SAFE_INTEGER`), in which case they stay strings.
 * - Lists are returned as-is; a literal `"null"` and the empty string stay
 *   strings (Java parity).
 */
export function smartCoerce(value: SlimValue): string | number | boolean | SlimValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (BOOLEAN_LITERAL.test(value)) {
    return value.toLowerCase() === "true";
  }
  if (NUMERIC_LITERAL.test(value)) {
    const parsed = Number(value);
    const losesIntegerPrecision = Number.isInteger(parsed) && !Number.isSafeInteger(parsed);
    if (Number.isFinite(parsed) && !losesIntegerPrecision) {
      return parsed;
    }
  }
  return value;
}
