/**
 * Shared types for the SLiM wire format.
 *
 * SLiM has only two types: strings and (nested) lists. A list is encoded as a
 * string, so a decoded value is always a string or a nested list. See
 * https://fitnesse.org/FitNesse/UserGuide/WritingAcceptanceTests/SliM/SlimProtocol.html
 */

/** A single decoded value inside a SLiM list. */
export type SlimValue = string | SlimValue[];

/** A decoded SLiM list. */
export type SlimList = SlimValue[];

/**
 * Anything {@link serialize} accepts.
 *
 * Strings and nested arrays are the wire model. Numbers and booleans are
 * stringified with `String(value)`, while `null` and `undefined` are encoded as
 * the literal string `null` (Java parity).
 */
export type SlimSerializable =
  string | number | boolean | null | undefined | readonly SlimSerializable[];
