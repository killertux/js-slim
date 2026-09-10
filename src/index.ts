/**
 * `@killertux/js-slim` — a typed SLiM protocol harness for FitNesse.
 *
 * This is the public entry point.
 */

/** The package version, kept in sync with `package.json`. */
export const VERSION = "0.1.0";

export { SlimSyntaxError } from "./protocol/errors.js";
export { MAX_NESTING_DEPTH, deserialize } from "./protocol/deserializer.js";
export { encodeLength, MINIMUM_NUMBER_LENGTH } from "./protocol/length.js";
export { serialize } from "./protocol/serializer.js";
export type { SlimList, SlimSerializable, SlimValue } from "./protocol/types.js";
