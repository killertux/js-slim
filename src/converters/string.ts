import type { SlimValue } from "../protocol/types.js";
import type { Converter } from "./types.js";

/** Render any decoded value the way Java's `List#toString` would. */
export function slimValueToString(value: SlimValue | null | undefined): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(slimValueToString).join(", ")}]`;
  }
  return value;
}

/** Identity conversion: SLiM strings are already JavaScript strings. */
export class StringConverter implements Converter<string> {
  toSlim(value: string | null | undefined): string | null {
    return value === null || value === undefined ? null : slimValueToString(value);
  }

  fromSlim(value: SlimValue): string {
    return slimValueToString(value);
  }
}
