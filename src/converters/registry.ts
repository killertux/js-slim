import type { SlimValue } from "../protocol/types.js";
import { BigIntConverter } from "./bigint.js";
import { BooleanConverter } from "./boolean.js";
import { DateConverter } from "./date.js";
import { ListConverter } from "./list.js";
import { MapConverter } from "./map.js";
import { NumberConverter } from "./number.js";
import { ObjectConverter } from "./object.js";
import { normalizeSlimType, type ConverterKey, type SlimType } from "./slim-type.js";
import { StringConverter } from "./string.js";
import type { Converter } from "./types.js";
import { VoidConverter } from "./void.js";

/**
 * Registry of {@link Converter}s keyed by {@link ConverterKey}.
 *
 * Instances start with the standard converters and can be customised; each
 * registry is independent, so tests and servers do not share mutable state.
 * String aliases (`"list"`, `"map"`, `"object"`) and {@link ListSlimType}
 * descriptors are normalised to their constructor key, so registering `Array`
 * also serves `"list"`.
 */
export class ConverterRegistry {
  private readonly converters = new Map<ConverterKey, Converter<unknown>>();

  constructor() {
    this.registerDefaults();
  }

  register(type: typeof String, converter: Converter<string>): void;
  register(type: typeof Number, converter: Converter<number>): void;
  register(type: typeof BigInt, converter: Converter<bigint>): void;
  register(type: typeof Boolean, converter: Converter<boolean>): void;
  register(type: typeof Date, converter: Converter<Date>): void;
  register(type: typeof Array, converter: Converter<SlimValue[]>): void;
  register(type: typeof Map, converter: Converter<Map<string, string>>): void;
  register(type: typeof Object, converter: Converter<unknown>): void;
  register(type: "void", converter: Converter<void>): void;
  register(type: "list", converter: Converter<SlimValue[]>): void;
  register(type: "map", converter: Converter<Map<string, string>>): void;
  register(type: "object", converter: Converter<unknown>): void;
  register(type: SlimType, converter: Converter<unknown>): void {
    this.converters.set(normalizeSlimType(type), converter);
  }

  /** Look up the converter for a type (aliases are normalised). */
  get<T = unknown>(type: SlimType): Converter<T> | undefined {
    return this.converters.get(normalizeSlimType(type)) as Converter<T> | undefined;
  }

  /** @returns true when a converter is registered for `type`. */
  has(type: SlimType): boolean {
    return this.converters.has(normalizeSlimType(type));
  }

  /** Remove a converter (e.g. to restore a customised registry). */
  remove(type: SlimType): void {
    this.converters.delete(normalizeSlimType(type));
  }

  private registerDefaults(): void {
    this.register(String, new StringConverter());
    this.register(Number, new NumberConverter());
    this.register(BigInt, new BigIntConverter());
    this.register(Boolean, new BooleanConverter());
    this.register(Date, new DateConverter());
    this.register(Array, new ListConverter());
    this.register(Map, new MapConverter());
    this.register(Object, new ObjectConverter());
    this.register("void", new VoidConverter());
  }
}

/** Process-wide default registry used when no other is supplied. */
export const defaultConverterRegistry = new ConverterRegistry();

/** Look up a converter, defaulting to the {@link defaultConverterRegistry}. */
export function getConverter<T = unknown>(
  type: SlimType,
  registry: ConverterRegistry = defaultConverterRegistry,
): Converter<T> | undefined {
  return registry.get<T>(type);
}
