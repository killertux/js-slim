import type { SlimValue } from "../protocol/types.js";

export type { ConverterKey, ListSlimType, SlimType } from "./slim-type.js";

/** Converts between decoded SLiM values and a fixture's JavaScript type. */
export interface Converter<T = unknown> {
  /** Render a fixture value as a SLiM string (`null` when there is no value). */
  toSlim(value: T | null | undefined): string | null;
  /** Convert a decoded SLiM value; blank input yields `null`. */
  fromSlim(value: SlimValue): T | null;
}
