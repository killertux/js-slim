import { encodeLength } from "./length.js";
import type { SlimList } from "./types.js";

/**
 * Pack a list into the SLiM serialized string format.
 *
 * Format: `[<count>:<length>:<item>:<length>:<item>:...]` where `count` and
 * `length` use the {@link encodeLength} prefix. Strings may be nested lists,
 * so lists of lists of lists are possible. `null` (and `undefined`) are
 * encoded as the literal string `null`; any other non-string value is
 * stringified with `String(value)`.
 *
 * Lengths are counted in UTF-16 code units (JavaScript's `String#length`),
 * *not* bytes — only the outer transport framing uses bytes.
 *
 * Port of `fitnesse.slim.protocol.SlimSerializer`.
 */
export function serialize(list: readonly unknown[]): string {
  if (!Array.isArray(list)) {
    throw new TypeError("SLiM serialize expects an array");
  }

  const parts: string[] = ["[", encodeLength(list.length)];

  for (const item of list) {
    const value = marshal(item);
    parts.push(encodeLength(value.length), value, ":");
  }

  parts.push("]");
  return parts.join("");
}

function marshal(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return serialize(value as SlimList);
  }
  return String(value);
}
