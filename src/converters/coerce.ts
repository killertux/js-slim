import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";
import type { SlimSerializable, SlimValue } from "../protocol/types.js";
import { formatDate } from "./date.js";
import { formatHashTable } from "./map.js";
import { defaultConverterRegistry, type ConverterRegistry } from "./registry.js";
import { isListType, normalizeSlimType, slimTypeName, type SlimType } from "./slim-type.js";
import { smartCoerce } from "./smart.js";
import { VOID_TAG } from "./void.js";

/**
 * Convert a decoded argument for a fixture.
 *
 * With a declared {@link SlimType} the matching converter is used (and a
 * missing converter raises `NO_CONVERTER_FOR_ARGUMENT_NUMBER`). A
 * {@link listOf} descriptor also converts each element. Without a declared type
 * the argument is smart-coerced (see {@link smartCoerce}).
 */
export function coerceValue(
  value: SlimValue,
  type?: SlimType | null,
  registry: ConverterRegistry = defaultConverterRegistry,
): unknown {
  if (type === undefined || type === null) {
    return smartCoerce(value);
  }

  if (isListType(type)) {
    // A hand-written descriptor may omit the element type; fail loudly rather
    // than silently leaving the elements as raw SLiM strings.
    if ((type as { element?: SlimType }).element === undefined) {
      throw noConverterError("list");
    }

    const converter = registry.get<SlimValue[]>(Array);
    if (converter === undefined) {
      throw noConverterError("list");
    }
    const list = converter.fromSlim(value);
    if (list === null) {
      return null;
    }
    // Elements go through `coerceArgument`, not `coerceValue`: a symbol may hold
    // a list whose items are already JavaScript values (a `number[]`), which a
    // converter would not understand.
    return list.map((item) => coerceArgument(item, type.element, registry));
  }

  const converter = registry.get(type);
  if (converter === undefined) {
    throw noConverterError(slimTypeName(type));
  }
  return converter.fromSlim(value);
}

/**
 * Convert an argument that came from the variable store.
 *
 * A declared type uses its converter; otherwise strings and lists are
 * smart-coerced and other values (symbol-as-object) pass through unchanged.
 *
 * A symbol may hold any JavaScript value, while a converter only understands
 * SLiM strings and lists, so a symbol value that already satisfies the declared
 * type is passed straight through (a `Date` for `Date`, `5` for `Number`) and
 * anything else is stringified first — `$n` holding the number `5` fills a
 * `String` parameter as `"5"` rather than arriving as a number.
 */
export function coerceArgument(
  value: unknown,
  type?: SlimType | null,
  registry: ConverterRegistry = defaultConverterRegistry,
): unknown {
  if (type === undefined || type === null) {
    if (typeof value === "string" || Array.isArray(value)) {
      return smartCoerce(value as SlimValue);
    }
    return value;
  }

  if (typeof value !== "string" && !Array.isArray(value)) {
    if (matchesDeclaredType(value, type)) {
      return value;
    }
    if (value === null || value === undefined) {
      return null;
    }
    return coerceValue(String(value), type, registry);
  }

  return coerceValue(value as SlimValue, type, registry);
}

/** Whether a symbol value already has the declared JavaScript type. */
function matchesDeclaredType(value: unknown, type: SlimType): boolean {
  // A value matching a list descriptor is routed through `coerceValue` by
  // `coerceArgument` before this is consulted, so a descriptor never matches here.
  if (isListType(type)) {
    return false;
  }

  switch (normalizeSlimType(type)) {
    case String:
      return typeof value === "string";
    case Number:
      return typeof value === "number";
    case BigInt:
      return typeof value === "bigint";
    case Boolean:
      return typeof value === "boolean";
    case Date:
      return value instanceof Date;
    case Array:
      return Array.isArray(value);
    case Map:
      return value instanceof Map;
    case Object:
      return (typeof value === "object" && value !== null) || typeof value === "function";
    default:
      return false;
  }
}

/**
 * Render a fixture return value for the wire.
 *
 * `undefined` becomes the void tag, `null` becomes a null value, and dates and
 * maps use the standard formats. Arrays are rendered recursively. When a return
 * type is declared, its converter is tried first so custom converters apply.
 */
export function toSlimValue(
  value: unknown,
  type?: SlimType | null,
  registry: ConverterRegistry = defaultConverterRegistry,
): string | null | SlimSerializable[] {
  if (value === undefined) {
    return VOID_TAG;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const element = isListType(type) ? type.element : undefined;
    return value.map((item) => toSlimValue(item, element, registry));
  }
  if (type !== undefined && type !== null) {
    const rendered = registry.get(type)?.toSlim(value as never);
    if (rendered !== undefined && rendered !== null) {
      return rendered;
    }
  }
  if (value instanceof Date) {
    return formatDate(value);
  }
  if (value instanceof Map) {
    return formatHashTable(value as ReadonlyMap<unknown, unknown>);
  }
  return String(value);
}

/** Build the `NO_CONVERTER_FOR_ARGUMENT_NUMBER` error for a type name. */
function noConverterError(typeName: string): SlimError {
  return new SlimError(
    formatSlimMessage(`${typeName}.`, SLIM_ERROR.NO_CONVERTER_FOR_ARGUMENT_NUMBER),
    { tag: SLIM_ERROR.NO_CONVERTER_FOR_ARGUMENT_NUMBER },
  );
}
