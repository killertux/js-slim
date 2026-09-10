/**
 * Length-prefix encoding used throughout the SLiM list format.
 *
 * A length is written as at least {@link MINIMUM_NUMBER_LENGTH} ASCII digits
 * followed by a `:`. Protocol version 0.4 and later allow the decimal
 * representation to grow beyond six digits for very long strings.
 */

/** Minimum number of digits in an encoded length. */
export const MINIMUM_NUMBER_LENGTH = 6;

/**
 * Encode a non-negative integer as a SLiM length prefix, e.g. `12` -> `"000012:"`.
 *
 * @throws {RangeError} if `length` is not a non-negative safe integer.
 */
export function encodeLength(length: number): string {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`Invalid SLiM length: ${String(length)}`);
  }
  return `${String(length).padStart(MINIMUM_NUMBER_LENGTH, "0")}:`;
}
