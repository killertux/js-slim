import { formatDate } from "../converters/date.js";
import { formatHashTable } from "../converters/map.js";
import type { SlimValue } from "../protocol/types.js";
import { isSymbolAssignment, substituteSymbols } from "./symbols.js";

/** A stored symbol: the raw value plus its text form. */
export interface StoredSymbol {
  readonly value: unknown;
  readonly text: string;
}

/**
 * Symbol table with `$name` substitution.
 *
 * A value can be used two ways: as a whole argument a `$name` reference yields
 * the raw object (so lists and objects survive), while inside a larger string
 * it is rendered to text. Port of `fitnesse.slim.VariableStore`.
 *
 * Expression symbols (`` $`expr` ``) are recognised but not evaluated; they stay
 * literal, which is the documented v1 limitation.
 */
export class VariableStore {
  private readonly symbols = new Map<string, StoredSymbol>();

  /** Store a symbol. `text` defaults to the value's SLiM rendering. */
  set(name: string, value: unknown, text?: string): void {
    this.symbols.set(name, { value, text: text ?? renderValue(value) });
  }

  /** @returns true when a symbol with this (bare) name is defined. */
  has(name: string): boolean {
    return this.symbols.has(name);
  }

  /** Look up a stored symbol, if defined. */
  get(name: string): StoredSymbol | undefined {
    return this.symbols.get(name);
  }

  /** Remove all symbols. */
  clear(): void {
    this.symbols.clear();
  }

  /**
   * @returns the raw value referenced by a whole-argument `$name`, or
   *   `undefined` when it is not a stored symbol.
   */
  getStored(nameWithDollar: string): unknown {
    if (!nameWithDollar.startsWith("$")) {
      return undefined;
    }
    return this.symbols.get(nameWithDollar.slice(1))?.value;
  }

  /** @returns true when a whole-argument `$name` refers to a stored symbol. */
  containsValueFor(nameWithDollar: string): boolean {
    return nameWithDollar.startsWith("$") && this.symbols.has(nameWithDollar.slice(1));
  }

  /** Replace symbols in each argument, recursively through nested lists. */
  replaceSymbols(args: readonly SlimValue[]): unknown[] {
    return args.map((arg) => this.replaceSymbol(arg));
  }

  /**
   * Replace symbols in a single string, except `$name =` assignments which
   * become the empty string.
   */
  replaceSymbolsInString(arg: string): string {
    if (isSymbolAssignment(arg) !== null) {
      return "";
    }
    return substituteSymbols(arg, (name) => this.symbols.get(name)?.text ?? null);
  }

  private replaceSymbol(arg: SlimValue): unknown {
    if (Array.isArray(arg)) {
      return arg.map((item) => this.replaceSymbol(item));
    }
    if (this.containsValueFor(arg)) {
      return this.getStored(arg);
    }
    return this.replaceSymbolsInString(arg);
  }
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return formatDate(value);
  }
  if (value instanceof Map) {
    return formatHashTable(value as ReadonlyMap<unknown, unknown>);
  }
  if (Array.isArray(value)) {
    return `[${value.map(renderValue).join(", ")}]`;
  }
  return String(value);
}
