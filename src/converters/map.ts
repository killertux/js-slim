import type { SlimValue } from "../protocol/types.js";
import { slimValueToString } from "./string.js";
import type { Converter } from "./types.js";

const TABLE_PATTERN = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const ROW_PATTERN = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_PATTERN = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

/** Render a `Map` as the FitNesse hash-widget HTML table. */
export function formatHashTable(map: ReadonlyMap<unknown, unknown>): string {
  let rows = "";
  for (const [key, value] of map) {
    const keyCell = escapeHtml(stringifyCell(key));
    const valueCell = escapeHtml(stringifyCell(value));
    rows +=
      `<tr class="hash_row"><td class="hash_key">${keyCell}</td>` +
      `<td class="hash_value">${valueCell}</td></tr>`;
  }
  return `<table class="hash_table">${rows}</table>`;
}

/**
 * Parse a FitNesse hash-widget table into a `Map`.
 *
 * @returns the parsed map, or `null` when the input is not a single table.
 *   Rows that do not have exactly two cells are ignored (Java parity).
 */
export function parseHashTable(html: string): Map<string, string> | null {
  const tables = [...html.matchAll(TABLE_PATTERN)];
  if (tables.length !== 1) {
    return null;
  }

  const map = new Map<string, string>();
  for (const row of (tables[0] as RegExpMatchArray)[1]!.matchAll(ROW_PATTERN)) {
    const cells = [...row[1]!.matchAll(CELL_PATTERN)].map((cell) => unescapeHtml(cell[1]!.trim()));
    if (cells.length === 2) {
      map.set(cells[0] as string, cells[1] as string);
    }
  }
  return map;
}

/** Map conversion via the FitNesse hash-widget HTML format. */
export class MapConverter implements Converter<Map<string, string>> {
  toSlim(value: Map<string, string> | null | undefined): string | null {
    return value === null || value === undefined ? null : formatHashTable(value);
  }

  fromSlim(value: SlimValue): Map<string, string> | null {
    const raw = slimValueToString(value);
    if (raw.trim() === "") {
      return null;
    }
    return parseHashTable(raw) ?? new Map<string, string>();
  }
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function unescapeHtml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}
