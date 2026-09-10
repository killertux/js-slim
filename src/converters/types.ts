import type { SlimValue } from "../protocol/types.js";

/**
 * A type a fixture parameter or return value can declare.
 *
 * JavaScript has a single `number` type, so `Number` covers what Java splits
 * into `int`/`double`; integral values that exceed `Number.MAX_SAFE_INTEGER`
 * should declare `BigInt`.
 */
export type SlimType =
  | typeof String
  | typeof Number
  | typeof BigInt
  | typeof Boolean
  | typeof Date
  | typeof Array
  | typeof Map
  | typeof Object
  | "void";

/** Converts between decoded SLiM values and a fixture's JavaScript type. */
export interface Converter<T = unknown> {
  /** Render a fixture value as a SLiM string (`null` when there is no value). */
  toSlim(value: T | null | undefined): string | null;
  /** Convert a decoded SLiM value; blank input yields `null`. */
  fromSlim(value: SlimValue): T | null;
}
