import type { SlimValue } from "../protocol/types.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

/** Boolean conversion: `true`/`false` out; `true`/`yes` (case-insensitive) in. */
export class BooleanConverter implements Converter<boolean> {
  static readonly TRUE = "true";
  static readonly FALSE = "false";
  static readonly YES = "yes";

  toSlim(value: boolean | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return value ? BooleanConverter.TRUE : BooleanConverter.FALSE;
  }

  fromSlim(value: SlimValue): boolean | null {
    const raw = slimValueToString(value);
    if (raw.trim() === "") {
      return null;
    }

    const lower = raw.toLowerCase();
    return lower === BooleanConverter.TRUE || lower === BooleanConverter.YES;
  }
}
