/**
 * Shared types for the SLiM wire format.
 *
 * SLiM has only two types: strings and (nested) lists. A list is encoded as a
 * string, so a list item may be a string, a nested list, or `null` (which is
 * encoded as the four-character string `null`). See
 * https://fitnesse.org/FitNesse/UserGuide/WritingAcceptanceTests/SliM/SlimProtocol.html
 */

/** A single item inside a serialized SLiM list. */
export type SlimValue = string | null | SlimValue[];

/** A SLiM list: an array of {@link SlimValue}s. */
export type SlimList = SlimValue[];
