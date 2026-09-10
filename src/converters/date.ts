import { SlimError, formatSlimMessage } from "../errors.js";
import type { SlimValue } from "../protocol/types.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

/** Java `SimpleDateFormat("dd-MMM-yyyy", Locale.US)` month names. */
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_INDEX = new Map(MONTH_NAMES.map((name, index) => [name.toLowerCase(), index]));

const DATE_PATTERN = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;

/** Format a date as `dd-MMM-yyyy` in UTC, e.g. `05-May-2009`. */
export function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTH_NAMES[date.getUTCMonth()] as string;
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  return `${day}-${month}-${year}`;
}

/** Parse `dd-MMM-yyyy` (day may omit the leading zero) in UTC, or return null. */
export function parseDate(raw: string): Date | null {
  const match = DATE_PATTERN.exec(raw.trim());
  if (match === null) {
    return null;
  }

  const day = Number(match[1]);
  const month = MONTH_INDEX.get((match[2] as string).toLowerCase());
  const year = Number(match[3]);

  if (month === undefined || day < 1 || day > 31) {
    return null;
  }
  return new Date(Date.UTC(year, month, day));
}

/**
 * Date conversion using FitNesse's `dd-MMM-yyyy` format.
 *
 * Unlike Java, dates are interpreted and rendered in UTC so results do not
 * depend on the host time zone.
 */
export class DateConverter implements Converter<Date> {
  toSlim(value: Date | null | undefined): string | null {
    return value === null || value === undefined ? null : formatDate(value);
  }

  fromSlim(value: SlimValue): Date | null {
    const raw = slimValueToString(value);
    if (raw.trim() === "") {
      return null;
    }

    const parsed = parseDate(raw);
    if (parsed === null) {
      throw new SlimError(formatSlimMessage(`Can't convert ${raw} to date.`));
    }
    return parsed;
  }
}
