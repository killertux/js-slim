import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";
import type { SlimSerializable, SlimValue } from "../protocol/types.js";
import { formatDate } from "./date.js";
import { formatHashTable } from "./map.js";
import { defaultConverterRegistry, type ConverterRegistry } from "./registry.js";
import { smartCoerce } from "./smart.js";
import type { SlimType } from "./types.js";
import { VOID_TAG } from "./void.js";

/**
 * Convert a decoded argument for a fixture.
 *
 * With a declared {@link SlimType} the matching converter is used (and a
 * missing converter raises `NO_CONVERTER_FOR_ARGUMENT_NUMBER`). Without one the
 * argument is smart-coerced (see {@link smartCoerce}).
 */
export function coerceValue(
  value: SlimValue,
  type?: SlimType | null,
  registry: ConverterRegistry = defaultConverterRegistry,
): unknown {
  if (type === undefined || type === null) {
    return smartCoerce(value);
  }

  const converter = registry.get(type);
  if (converter === undefined) {
    throw new SlimError(
      formatSlimMessage(`${slimTypeName(type)}.`, SLIM_ERROR.NO_CONVERTER_FOR_ARGUMENT_NUMBER),
      { tag: SLIM_ERROR.NO_CONVERTER_FOR_ARGUMENT_NUMBER },
    );
  }
  return converter.fromSlim(value);
}

/**
 * Convert an argument that came from the variable store.
 *
 * A declared type uses its converter; otherwise strings and lists are
 * smart-coerced and other values (symbol-as-object) pass through unchanged.
 */
export function coerceArgument(
  value: unknown,
  type?: SlimType | null,
  registry: ConverterRegistry = defaultConverterRegistry,
): unknown {
  if (type !== undefined && type !== null) {
    return coerceValue(value as SlimValue, type, registry);
  }
  if (typeof value === "string" || Array.isArray(value)) {
    return smartCoerce(value as SlimValue);
  }
  return value;
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
    return value.map((item) => toSlimValue(item, undefined, registry));
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

/** Human-readable name for a `SlimType`, used in error messages. */
function slimTypeName(type: SlimType): string {
  return typeof type === "string" ? type : type.name;
}
