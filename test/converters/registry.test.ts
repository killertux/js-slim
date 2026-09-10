import { describe, expect, it } from "vitest";

import {
  ConverterRegistry,
  defaultConverterRegistry,
  getConverter,
} from "../../src/converters/registry.js";
import type { SlimValue } from "../../src/protocol/types.js";
import { listOf } from "../../src/converters/slim-type.js";
import type { Converter } from "../../src/converters/types.js";

class UpperConverter implements Converter<string> {
  toSlim(value: string | null | undefined): string | null {
    return value === null || value === undefined ? null : value.toUpperCase();
  }

  fromSlim(value: string): string {
    return String(value).toLowerCase();
  }
}

describe("ConverterRegistry", () => {
  it("registers the standard converters by default", () => {
    const registry = new ConverterRegistry();
    expect(registry.has(String)).toBe(true);
    expect(registry.has(Number)).toBe(true);
    expect(registry.has(BigInt)).toBe(true);
    expect(registry.has(Boolean)).toBe(true);
    expect(registry.has(Date)).toBe(true);
    expect(registry.has(Array)).toBe(true);
    expect(registry.has(Map)).toBe(true);
    expect(registry.has(Object)).toBe(true);
    expect(registry.has("void")).toBe(true);
  });

  it("registers and resolves a custom converter", () => {
    const registry = new ConverterRegistry();
    registry.register(String, new UpperConverter());

    expect(registry.get<string>(String)?.fromSlim("ABC")).toBe("abc");
    expect(registry.get<string>(String)?.toSlim("abc")).toBe("ABC");
  });

  it("keeps instances isolated from each other and from the default registry", () => {
    const registry = new ConverterRegistry();
    registry.register(String, new UpperConverter());

    expect(registry.get(String)).toBeInstanceOf(UpperConverter);
    expect(defaultConverterRegistry.get(String)).not.toBeInstanceOf(UpperConverter);
    expect(getConverter(String)).toBe(defaultConverterRegistry.get(String));
  });

  it("removes a converter", () => {
    const registry = new ConverterRegistry();
    registry.remove(String);
    expect(registry.has(String)).toBe(false);
  });

  it("looks converters up in an explicit registry", () => {
    const registry = new ConverterRegistry();
    registry.register(String, new UpperConverter());
    expect(getConverter(String, registry)).toBeInstanceOf(UpperConverter);
  });
});

describe("collection aliases", () => {
  it("normalises the string aliases onto their constructors", () => {
    const registry = new ConverterRegistry();

    expect(registry.get("list")).toBe(registry.get(Array));
    expect(registry.get("map")).toBe(registry.get(Map));
    expect(registry.get("object")).toBe(registry.get(Object));
    expect(registry.get(listOf(Number))).toBe(registry.get(Array));
    expect(registry.has("list")).toBe(true);
  });

  it("registers and removes through an alias", () => {
    class UpperListConverter implements Converter<SlimValue[]> {
      toSlim(value: SlimValue[] | null | undefined): string | null {
        return value === null || value === undefined ? null : value.join(",").toUpperCase();
      }

      fromSlim(value: SlimValue): SlimValue[] {
        return [String(value).toUpperCase()];
      }
    }

    const registry = new ConverterRegistry();
    registry.register("list", new UpperListConverter());

    expect(registry.get(Array)).toBeInstanceOf(UpperListConverter);

    registry.remove("list");
    expect(registry.has(Array)).toBe(false);
  });
});
