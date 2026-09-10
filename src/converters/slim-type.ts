/**
 * The SLiM type system: what a fixture parameter or return value can declare.
 *
 * There is no runtime type information in JavaScript, so fixtures declare types
 * as *values* — a constructor (`Number`), a collection name (`"list"`) or a
 * {@link listOf} descriptor for element types. The runtime uses them to pick a
 * {@link Converter} instead of guessing with smart coercion.
 */

/**
 * Types the converter registry can be keyed by.
 *
 * `Number` covers what Java splits into `int`/`double`; integral values beyond
 * `Number.MAX_SAFE_INTEGER` should declare `BigInt`. The string forms are
 * aliases for the collection constructors so metadata written as plain data can
 * name a list without referencing `Array`.
 */
export type ConverterKey =
  | typeof String
  | typeof Number
  | typeof BigInt
  | typeof Boolean
  | typeof Date
  | typeof Array
  | typeof Map
  | typeof Object
  | "list"
  | "map"
  | "object"
  | "void";

/** A list with a declared element type, e.g. `listOf(Number)` for `number[]`. */
export interface ListSlimType {
  readonly kind: "list";
  readonly element: SlimType;
}

/** A type a fixture parameter or return value can declare. */
export type SlimType = ConverterKey | ListSlimType;

/**
 * Declare a list's element type.
 *
 * A bare `Array` (or `"list"`) converts to a list of raw SLiM strings — the
 * decoded list's items are not coerced. Use `listOf(Number)` to get
 * `[1, 2, 3]` from `|1,2,3|`.
 */
export function listOf(element: SlimType): ListSlimType {
  return { kind: "list", element };
}

/** @returns true when `type` is a {@link ListSlimType} descriptor. */
export function isListType(type: SlimType | null | undefined): type is ListSlimType {
  return typeof type === "object" && type !== null && type.kind === "list";
}

/** Map string aliases and list descriptors onto a registry key. */
export function normalizeSlimType(type: SlimType): ConverterKey {
  if (isListType(type)) {
    return Array;
  }

  switch (type) {
    case "list":
      return Array;
    case "map":
      return Map;
    case "object":
      return Object;
    default:
      return type;
  }
}

/** Human-readable name for a `SlimType`, used in error messages. */
export function slimTypeName(type: SlimType): string {
  if (isListType(type)) {
    return `list<${slimTypeName(type.element)}>`;
  }
  return typeof type === "string" ? type : type.name;
}
