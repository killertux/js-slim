import type { SlimValue } from "../protocol/types.js";

/** Numeric literal syntax accepted by the numeric converters. */
export const NUMERIC_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Integer literal syntax accepted by the big-integer converter. */
export const INTEGER_PATTERN = /^[+-]?\d+$/;

/** Boolean literals recognised by smart coercion (`yes`/`no` stay strings). */
const BOOLEAN_LITERAL = /^(true|false)$/i;

/** A literal whose numeric value is legitimately zero. */
const ZERO_LITERAL = /^[+-]?0*(\.0*)?([eE][+-]?\d+)?$/;

/**
 * Default conversion for an un-annotated argument.
 *
 * - `true`/`false` (case-insensitive) become booleans; `yes`/`no` stay strings.
 * - Numeric literals become numbers unless that would lose integer precision
 *   (bigger than `Number.MAX_SAFE_INTEGER`) or underflow to `0`.
 * - Lists are returned as-is; a literal `"null"` and the empty string stay
 *   strings (Java parity). No trimming is performed, so `" 42 "` stays a
 *   string here while the typed `Number` converter would accept it.
 */
export function smartCoerce(value: SlimValue): string | number | boolean | SlimValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (BOOLEAN_LITERAL.test(value)) {
    return value.toLowerCase() === "true";
  }
  if (NUMERIC_PATTERN.test(value)) {
    const parsed = Number(value);
    const losesIntegerPrecision = Number.isInteger(parsed) && !Number.isSafeInteger(parsed);
    const underflowsToZero = parsed === 0 && !ZERO_LITERAL.test(value);
    if (Number.isFinite(parsed) && !losesIntegerPrecision && !underflowsToZero) {
      return parsed;
    }
  }
  return value;
}
