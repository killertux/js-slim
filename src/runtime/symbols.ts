/**
 * Matches a symbol reference: `$name` or `` $`expression` ``.
 *
 * Port of `fitnesse.slim.SlimSymbol.SYMBOL_PATTERN`. The `u` flag is required
 * for the `\p{L}` (Unicode letter) classes.
 *
 * Note: this is a stateful global regex — do not loop over it with `exec`/`test`
 * without resetting `lastIndex`; {@link substituteSymbols} uses its own copy.
 */
export const SYMBOL_PATTERN = /\$(([A-Za-z\p{L}][\w\p{L}]*)|`([^`]+)`)/gu;

/**
 * Matches the symbol-assignment syntax `$name =` (used by decision tables).
 *
 * Port of `fitnesse.slim.SlimSymbol.SYMBOL_ASSIGNMENT_PATTERN`.
 */
export const SYMBOL_ASSIGNMENT_PATTERN = /^\s*\$([A-Za-z\p{L}][\w\p{L}]*)\s*=\s*$/u;

/** Resolves a symbol name to its text value, or `null` when undefined. */
export type SymbolResolver = (name: string) => string | null;

/** Scan copy of {@link SYMBOL_PATTERN}; `lastIndex` is always set before use. */
const SCAN_PATTERN = new RegExp(SYMBOL_PATTERN.source, SYMBOL_PATTERN.flags);

/**
 * @returns the symbol name when `content` is a `$name =` assignment, else `null`.
 */
export function isSymbolAssignment(content: string | null | undefined): string | null {
  if (content === null || content === undefined) {
    return null;
  }
  const match = SYMBOL_ASSIGNMENT_PATTERN.exec(content);
  return match === null ? null : (match[1] as string);
}

interface SymbolMatch {
  /** The matched text, e.g. `$v1`. */
  readonly full: string;
  /** The resolved symbol name (may be a shorter prefix), without `$`. */
  readonly name: string;
  /** The resolved value, or `null` when the symbol is undefined. */
  readonly value: string | null;
  readonly start: number;
  readonly end: number;
}

/**
 * Replace every `$symbol` in `text` with its value.
 *
 * When a symbol is undefined, progressively shorter prefixes are tried (so
 * `$v1` resolves to the value of `$v` when `v1` is unknown, leaving the `1` in
 * place). Undefined symbols and `$name =` assignments are left untouched.
 *
 * Port of `fitnesse.slim.SlimSymbol#replace`.
 */
export function substituteSymbols(text: string, resolve: SymbolResolver): string {
  if (isSymbolAssignment(text) !== null) {
    return text;
  }

  let result = text;
  let from = 0;

  for (;;) {
    const match = findSymbol(result, from, resolve);
    if (match === null) {
      break;
    }

    const replacement = match.value ?? match.full;
    result = result.slice(0, match.start) + replacement + result.slice(match.end);
    from = Math.min(match.start + replacement.length, result.length);
  }

  return result;
}

function findSymbol(text: string, from: number, resolve: SymbolResolver): SymbolMatch | null {
  SCAN_PATTERN.lastIndex = from;
  const match = SCAN_PATTERN.exec(text);
  if (match === null) {
    return null;
  }

  let name = match[1] as string;
  let value = resolve(name);

  if (value === null) {
    // The full name is unknown; fall back to the longest resolvable prefix.
    for (let i = name.length - 1; i > 0; i -= 1) {
      const shorter = name.slice(0, i);
      const shorterValue = resolve(shorter);
      if (shorterValue !== null) {
        name = shorter;
        value = shorterValue;
        break;
      }
    }
  }

  return {
    full: match[0],
    name,
    value,
    start: match.index,
    end: match.index + name.length + 1,
  };
}
