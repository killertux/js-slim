import { SlimError, formatSlimMessage } from "../errors.js";
import type { SlimValue } from "../protocol/types.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

/**
 * Number conversion.
 *
 * Unlike Java's `IntConverter`, this accepts fractional literals too, because
 * JavaScript has a single `number` type. Blank input yields `null`.
 */
export class NumberConverter implements Converter<number> {
  toSlim(value: number | null | undefined): string | null {
    return value === null || value === undefined ? null : String(value);
  }

  fromSlim(value: SlimValue): number | null {
    const raw = slimValueToString(value);
    if (raw.trim() === "") {
      return null;
    }

    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed)) {
      throw new SlimError(formatSlimMessage(`Can't convert ${raw} to number.`));
    }
    return parsed;
  }
}
