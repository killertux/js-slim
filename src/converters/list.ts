import type { SlimValue } from "../protocol/types.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

/**
 * Parse the string form of a list.
 *
 * Port of `ListConverterHelper.fromStringToArrayOfStrings`: optional
 * surrounding brackets are removed, the remainder is split on commas and each
 * item is trimmed. A blank entry yields an empty list.
 */
export function parseListString(value: string): string[] {
  let body = value;
  if (body.startsWith("[")) {
    body = body.slice(1);
  }
  if (body.endsWith("]")) {
    body = body.slice(0, -1);
  }
  if (body.trim() === "") {
    return [];
  }
  return body.split(",").map((item) => item.trim());
}

/** List conversion: already-decoded lists pass through, strings are parsed. */
export class ListConverter implements Converter<SlimValue[]> {
  toSlim(value: SlimValue[] | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return `[${value.map((item) => slimValueToString(item)).join(", ")}]`;
  }

  fromSlim(value: SlimValue): SlimValue[] {
    return Array.isArray(value) ? value : parseListString(value);
  }
}
