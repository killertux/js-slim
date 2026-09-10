import { BigIntConverter } from "./bigint.js";
import { BooleanConverter } from "./boolean.js";
import { DateConverter } from "./date.js";
import { ListConverter } from "./list.js";
import { MapConverter } from "./map.js";
import { NumberConverter } from "./number.js";
import { ObjectConverter } from "./object.js";
import { StringConverter } from "./string.js";
import type { Converter, SlimType } from "./types.js";
import { VoidConverter } from "./void.js";

/**
 * Registry of {@link Converter}s keyed by {@link SlimType}.
 *
 * Instances start with the standard converters and can be customised; each
 * registry is independent, so tests and servers do not share mutable state.
 */
export class ConverterRegistry {
  private readonly converters = new Map<SlimType, Converter<unknown>>();

  constructor() {
    this.registerDefaults();
  }

  /** Register (or replace) the converter for a type. */
  register<T>(type: SlimType, converter: Converter<T>): void {
    this.converters.set(type, converter as unknown as Converter<unknown>);
  }

  /** Look up the converter for a type, if any. */
  get<T = unknown>(type: SlimType): Converter<T> | undefined {
    return this.converters.get(type) as Converter<T> | undefined;
  }

  /** @returns true when a converter is registered for `type`. */
  has(type: SlimType): boolean {
    return this.converters.has(type);
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

/** Look up a converter in the {@link defaultConverterRegistry}. */
export function getConverter<T = unknown>(type: SlimType): Converter<T> | undefined {
  return defaultConverterRegistry.get<T>(type);
}
