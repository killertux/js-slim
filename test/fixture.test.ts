import { describe, expect, it } from "vitest";

import {
  FIXTURE_META,
  METHOD_META,
  declaredFixtureName,
  declaredSutName,
  defineFixture,
  fixture,
  getFixtureMeta,
  getFixtureMethodMeta,
  getMethodMeta,
  getOwnMethodMeta,
  isFactoryFixture,
  methodWireName,
  slimFixture,
  slimMethod,
  type FixtureMeta,
  type MethodMeta,
} from "../src/fixture.js";

describe("slimFixture", () => {
  it("attaches metadata without replacing the class", () => {
    @slimFixture({ name: "Renamed", sut: "service" })
    class Subject {}

    const meta = getFixtureMeta(Subject);
    expect(meta).toEqual({ name: "Renamed", sut: "service" });
    expect(declaredFixtureName(Subject)).toBe("Renamed");
    expect(declaredSutName(Subject)).toBe("service");
    expect(Subject.name).toBe("Subject");
  });

  it("stores metadata under a global symbol so duplicated copies agree", () => {
    @slimFixture({ name: "Shared" })
    class Subject {}

    // Symbol.for keys are shared across module instances (ESM vs CJS builds).
    expect(FIXTURE_META).toBe(Symbol.for("@killertux/js-slim/fixture"));
    expect(METHOD_META).toBe(Symbol.for("@killertux/js-slim/method"));
    expect((Subject as unknown as Record<symbol, unknown>)[FIXTURE_META]).toEqual({
      name: "Shared",
    });
  });

  it("keeps metadata non-enumerable", () => {
    @slimFixture({ name: "Hidden" })
    class Subject {}

    expect(Object.keys(Subject)).not.toContain(String(FIXTURE_META));
    expect(JSON.stringify(getFixtureMeta(Subject))).toBe('{"name":"Hidden"}');
  });

  it("defaults to empty metadata", () => {
    @slimFixture()
    class Subject {}

    expect(getFixtureMeta(Subject)).toEqual({});
  });
});

describe("slimMethod", () => {
  it("attaches metadata to the method function", () => {
    class Subject {
      @slimMethod({ name: "sum of", params: [Number], returns: Number })
      sumOf(value: number): number {
        return value;
      }
    }

    const method = Subject.prototype.sumOf as unknown as Record<symbol, unknown>;
    expect(method[METHOD_META]).toEqual({ name: "sum of", params: [Number], returns: Number });

    const instance = new Subject();
    expect(getOwnMethodMeta(instance.sumOf)).toEqual({
      name: "sum of",
      params: [Number],
      returns: Number,
    });
    expect(methodWireName(instance, "sumOf", instance.sumOf)).toBe("sum of");
  });

  it("leaves the method callable", () => {
    class Subject {
      @slimMethod({ returns: Number })
      double(value: number): number {
        return value * 2;
      }
    }

    expect(new Subject().double(21)).toBe(42);
  });
});

describe("defineFixture", () => {
  it("merges later metadata into earlier metadata", () => {
    class Subject {}

    defineFixture(Subject, { name: "First" });
    defineFixture(Subject, { sut: "inner" });

    expect(getFixtureMeta(Subject)).toEqual({ name: "First", sut: "inner" });
  });

  it("merges per-method metadata key by key", () => {
    class Subject {
      one(): void {}
      two(): void {}
    }

    defineFixture(Subject, { methods: { one: { params: [Number] } } });
    defineFixture(Subject, { methods: { two: { returns: Number } } });

    expect(getFixtureMeta(Subject)?.methods).toEqual({
      one: { params: [Number] },
      two: { returns: Number },
    });
  });

  it("lets a later call replace a single method entry", () => {
    class Subject {
      one(): void {}
    }

    defineFixture(Subject, { methods: { one: { params: [Number] } } });
    defineFixture(Subject, { methods: { one: { returns: String } } });

    expect(getFixtureMethodMeta(Subject, "one")).toEqual({ returns: String });
  });
});

describe("fixture", () => {
  it("attaches metadata and returns the class", () => {
    class Subject {}

    const returned = fixture({
      class: Subject,
      name: "Alias",
      sut: "inner",
      methods: { tick: { returns: Number } },
    });

    expect(returned).toBe(Subject);
    expect(getFixtureMeta(Subject)).toEqual({
      name: "Alias",
      sut: "inner",
      methods: { tick: { returns: Number } },
    });
  });

  it("supports factory exports", () => {
    const build = (): { value: number } => ({ value: 1 });

    fixture({ class: build as unknown as new () => unknown, factory: true });

    expect(isFactoryFixture(build)).toBe(true);
  });

  it("is not a factory by default", () => {
    class Subject {}
    fixture({ class: Subject });

    expect(isFactoryFixture(Subject)).toBe(false);
  });
});

describe("metadata readers", () => {
  it("returns undefined for values that cannot hold metadata", () => {
    for (const value of [undefined, null, 42, "text", true]) {
      expect(getFixtureMeta(value)).toBeUndefined();
      expect(getOwnMethodMeta(value)).toBeUndefined();
    }
  });

  it("returns undefined for undecorated functions", () => {
    class Plain {}

    expect(getFixtureMeta(Plain)).toBeUndefined();
    expect(getFixtureMethodMeta(Plain, "anything")).toBeUndefined();
    expect(declaredFixtureName(Plain)).toBeUndefined();
    expect(declaredSutName(Plain)).toBeUndefined();
  });

  it("prefers the method's own metadata over the fixture table", () => {
    class Subject {
      @slimMethod({ name: "own" })
      doIt(): void {}
    }

    defineFixture(Subject, { methods: { doIt: { name: "table" } } });

    const instance = new Subject();
    expect(getMethodMeta(instance, instance.doIt, "doIt")).toEqual({ name: "own" });
    expect(methodWireName(instance, "doIt", instance.doIt)).toBe("own");
  });

  it("falls back to the fixture table when the method has none", () => {
    class Subject {
      doIt(): void {}
    }

    defineFixture(Subject, { methods: { doIt: { name: "table", returns: Number } } });

    const instance = new Subject();
    expect(getMethodMeta(instance, instance.doIt, "doIt")).toEqual({
      name: "table",
      returns: Number,
    });
    expect(methodWireName(instance, "doIt", instance.doIt)).toBe("table");
  });

  it("defaults the wire name to the JavaScript name", () => {
    class Subject {
      doIt(): void {}
    }

    const instance = new Subject();
    expect(methodWireName(instance, "doIt", instance.doIt)).toBe("doIt");
  });
});

describe("metadata types", () => {
  it("accepts the documented shapes", () => {
    const meta: FixtureMeta = {
      name: "Fixture",
      sut: "inner",
      factory: false,
      methods: { call: { name: "wire name", params: [String, Number], returns: String } },
    };
    const method: MethodMeta = { params: [String] };

    expect(meta.methods?.call?.params).toEqual([String, Number]);
    expect(method.params).toEqual([String]);
  });
});
