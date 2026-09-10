import { describe, expect, it } from "vitest";

import { defaultConverterRegistry } from "../../src/converters/registry.js";
import { listOf } from "../../src/converters/slim-type.js";
import type { Converter } from "../../src/converters/types.js";
import { defineFixture } from "../../src/fixture.js";
import { VOID_TAG } from "../../src/converters/void.js";
import { StopTestError } from "../../src/errors.js";
import { parseInstruction } from "../../src/instructions/parse.js";
import type { SlimList } from "../../src/protocol/types.js";
import { ExecutionContext } from "../../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../../src/runtime/fixture-loader.js";
import { StatementExecutor, type SlimRow } from "../../src/runtime/statement-executor.js";

class TestFixture {
  value = 0;
  sut?: object;

  addTo(a: number, b: number): number {
    return a + b;
  }

  echoString(value: string): string {
    return value;
  }

  returnString(): string {
    return "string";
  }

  voidFunction(): void {
    // intentionally empty
  }

  nullString(): null {
    return null;
  }

  asyncValue(): Promise<string> {
    return Promise.resolve("async");
  }

  setValue(value: number): void {
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }

  createObject(): object {
    return { hello: () => "world" };
  }

  stopTest(): never {
    throw new StopTestError("stop now");
  }
}

class ConstructorFixture {
  constructor(private readonly arg: string) {}

  getArg(): string {
    return this.arg;
  }
}

class SutTarget {
  targetMethod(): string {
    return "sut";
  }
}

class SutHolder {
  sut?: object;

  useTarget(): void {
    this.sut = new SutTarget();
  }
}

class LibraryFixture {
  libMethod(): string {
    return "lib";
  }
}

class ListFixture {
  echo(value: unknown): unknown {
    return value;
  }
}

class StopConstructorFixture {
  constructor() {
    throw new StopTestError("constructor stop");
  }
}

class ThrowingConstructorFixture {
  constructor() {
    throw new Error("thrown message");
  }
}

function setup(): {
  executor: StatementExecutor;
  register: (name: string, ctor: FixtureConstructor) => void;
} {
  const registry = new Map<string, FixtureConstructor>();
  const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
  const context = new ExecutionContext({ fixtureLoader: loader });
  return {
    executor: new StatementExecutor({ context }),
    register: (name, ctor) => registry.set(name, ctor),
  };
}

function run(executor: StatementExecutor, rows: readonly SlimList[]): Promise<SlimRow[]> {
  return executor.executeAll(rows.map((row) => parseInstruction(row)));
}

describe("StatementExecutor", () => {
  it("runs import, make and call", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["i1", "import", "/fixtures"],
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "addTo", "2", "3"],
    ]);

    expect(results).toEqual([
      ["i1", "OK"],
      ["m1", "OK"],
      ["c1", "5"],
    ]);
    expect(executor.context.paths).toEqual(["/fixtures"]);
  });

  it("passes constructor arguments", async () => {
    const { executor, register } = setup();
    register("ConstructorFixture", ConstructorFixture);

    const results = await run(executor, [
      ["m1", "make", "fixture", "ConstructorFixture", "hello"],
      ["c1", "call", "fixture", "getArg"],
    ]);

    expect(results[1]).toEqual(["c1", "hello"]);
  });

  it("awaits async methods", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "asyncValue"],
    ]);

    expect(results[1]).toEqual(["c1", "async"]);
  });

  it("returns the void tag for void methods and null for null results", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "voidFunction"],
      ["c2", "call", "testSlim", "nullString"],
    ]);

    expect(results[1]).toEqual(["c1", VOID_TAG]);
    expect(results[2]).toEqual(["c2", null]);
  });

  it("stores assign symbols and substitutes them", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["a1", "assign", "v", "Bob"],
      ["c1", "call", "testSlim", "echoString", "hi $v"],
    ]);

    expect(results[1]).toEqual(["a1", "OK"]);
    expect(results[2]).toEqual(["c1", "hi Bob"]);
  });

  it("stores callAndAssign results and substitutes them", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "callAndAssign", "v", "testSlim", "addTo", "5", "6"],
      ["c2", "call", "testSlim", "echoString", "$v"],
    ]);

    expect(results[1]).toEqual(["c1", "11"]);
    expect(results[2]).toEqual(["c2", "11"]);
    expect(executor.getSymbol("v")).toBe("11");
    expect(executor.getSymbolObject("v")).toBe(11);
  });

  it("falls back to the System Under Test", async () => {
    const { executor, register } = setup();
    register("SutHolder", SutHolder);

    const results = await run(executor, [
      ["m1", "make", "holder", "SutHolder"],
      ["c0", "call", "holder", "useTarget"],
      ["c1", "call", "holder", "targetMethod"],
    ]);

    expect(results[2]).toEqual(["c1", "sut"]);
  });

  it("falls back to libraries", async () => {
    const { executor, register } = setup();
    register("LibraryFixture", LibraryFixture);
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "libraryFoo", "LibraryFixture"],
      ["m2", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "libMethod"],
    ]);

    expect(results[2]).toEqual(["c1", "lib"]);
  });

  it("registers a symbol-copied fixture instance via make", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "callAndAssign", "v", "testSlim", "createObject"],
      ["m2", "make", "chained", "$v"],
      ["c2", "call", "chained", "hello"],
    ]);

    expect(results[3]).toEqual(["c2", "world"]);
  });

  it("reports NO_INSTANCE for unknown instances", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "missing", "addTo", "1", "2"],
    ]);

    expect(String(results[1]?.[1])).toContain("__EXCEPTION__:");
    expect(String(results[1]?.[1])).toContain("NO_INSTANCE missing.addTo.");
  });

  it("reports NO_METHOD_IN_CLASS with the available methods", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "missing", "1", "2"],
    ]);

    const error = String(results[1]?.[1]);
    expect(error).toContain("NO_METHOD_IN_CLASS No Method missing[2] in class TestFixture.");
    expect(error).toContain("addTo(2)");
  });

  it("reports MALFORMED_INSTRUCTION for unknown operations", async () => {
    const { executor } = setup();

    const results = await run(executor, [["inv1", "invalidOperation"]]);
    expect(String(results[0]?.[1])).toContain("MALFORMED_INSTRUCTION invalidOperation");
  });

  it("reports COULD_NOT_INVOKE_CONSTRUCTOR when a class cannot be loaded", async () => {
    const { executor } = setup();

    const results = await run(executor, [["m1", "make", "testSlim", "NoSuchFixture"]]);
    expect(String(results[0]?.[1])).toContain("COULD_NOT_INVOKE_CONSTRUCTOR NoSuchFixture[0]");
  });

  it("passes a constructor's own exception through", async () => {
    const { executor, register } = setup();
    register("ThrowingConstructorFixture", ThrowingConstructorFixture);

    const results = await run(executor, [["m1", "make", "x", "ThrowingConstructorFixture"]]);
    const value = String(results[0]?.[1]);

    expect(value).toContain("thrown message");
    expect(value).not.toContain("COULD_NOT_INVOKE_CONSTRUCTOR");
  });

  it("keeps the stop marker for a constructor that aborts the test", async () => {
    const { executor, register } = setup();
    register("StopConstructorFixture", StopConstructorFixture);

    const results = await run(executor, [
      ["m1", "make", "x", "StopConstructorFixture"],
      ["m2", "make", "y", "StopConstructorFixture"],
    ]);

    expect(results).toHaveLength(1);
    expect(String(results[0]?.[1])).toContain("__EXCEPTION__:ABORT_SLIM_TEST:");
  });

  it("smart-coerces scalars and passes lists through", async () => {
    const { executor, register } = setup();
    register("ListFixture", ListFixture);

    const results = await run(executor, [
      ["m1", "make", "f", "ListFixture"],
      ["c1", "call", "f", "echo", "007"],
      ["c2", "call", "f", "echo", ["a", "b"]],
    ]);

    expect(results[1]).toEqual(["c1", "7"]);
    expect(results[2]).toEqual(["c2", ["a", "b"]]);
  });

  it("returns null for unset symbols", () => {
    const { executor } = setup();
    expect(executor.getSymbol("missing")).toBeNull();
    expect(executor.getSymbolObject("missing")).toBeNull();
  });

  it("continues after a normal error", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "missing", "addTo", "1", "2"],
      ["c2", "call", "testSlim", "returnString"],
    ]);

    expect(results).toHaveLength(3);
    expect(results[2]).toEqual(["c2", "string"]);
  });

  it("stops the batch on a stop test error and resets afterwards", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "stopTest"],
      ["c2", "call", "testSlim", "returnString"],
    ]);

    expect(results).toHaveLength(2);
    expect(String(results[1]?.[1])).toContain("__EXCEPTION__:ABORT_SLIM_TEST:");
    expect(executor.stopHasBeenRequested()).toBe(false);

    const next = await run(executor, [["c3", "call", "testSlim", "returnString"]]);
    expect(next).toEqual([["c3", "string"]]);
  });

  it("supports the helper library from a fixture call", async () => {
    const { executor, register } = setup();
    register("TestFixture", TestFixture);

    const results = await run(executor, [
      ["m1", "make", "scriptTableActor", "TestFixture"],
      ["m2", "make", "testSlim", "TestFixture"],
      ["c1", "call", "testSlim", "pushFixture"],
      ["c2", "call", "testSlim", "popFixture"],
      ["c3", "call", "testSlim", "cloneSymbol", "x"],
    ]);

    expect(results[2]).toEqual(["c1", VOID_TAG]);
    expect(results[3]).toEqual(["c2", VOID_TAG]);
    expect(results[4]).toEqual(["c3", "x"]);
  });
});

describe("declared method metadata", () => {
  it("converts arguments with a declared list element type", async () => {
    class TypedFixture {
      sumOf(values: number[]): number {
        return values.reduce((total, value) => total + value, 0);
      }
    }
    defineFixture(TypedFixture, { methods: { sumOf: { params: [listOf(Number)] } } });

    const { executor, register } = setup();
    register("TypedFixture", TypedFixture);

    const rows = await run(executor, [
      ["m1", "make", "typed", "TypedFixture"],
      ["c1", "call", "typed", "sumOf", "1,2,3"],
    ]);

    expect(rows[1]).toEqual(["c1", "6"]);
  });

  it("keeps raw SLiM strings for an untyped list parameter", async () => {
    class RawFixture {
      join(values: string[]): string {
        return values.join("|");
      }
    }
    defineFixture(RawFixture, { methods: { join: { params: [Array] } } });

    const { executor, register } = setup();
    register("RawFixture", RawFixture);

    const rows = await run(executor, [
      ["m1", "make", "raw", "RawFixture"],
      ["c1", "call", "raw", "join", "a,b"],
    ]);

    expect(rows[1]).toEqual(["c1", "a|b"]);
  });

  it("converts scalar arguments with declared types", async () => {
    class ScalarFixture {
      add(a: number, b: number): number {
        return a + b;
      }
    }
    defineFixture(ScalarFixture, { methods: { add: { params: [Number, Number] } } });

    const { executor, register } = setup();
    register("ScalarFixture", ScalarFixture);

    const rows = await run(executor, [
      ["m1", "make", "s", "ScalarFixture"],
      ["c1", "call", "s", "add", "2", "3"],
    ]);

    expect(rows[1]).toEqual(["c1", "5"]);
  });

  it("invokes a method through its declared alias", async () => {
    class AliasFixture {
      sumOf(a: number, b: number): number {
        return a + b;
      }
    }
    defineFixture(AliasFixture, { methods: { sumOf: { name: "sum of" } } });

    const { executor, register } = setup();
    register("AliasFixture", AliasFixture);

    const rows = await run(executor, [
      ["m1", "make", "a", "AliasFixture"],
      ["c1", "call", "a", "sum of", "2", "3"],
    ]);

    expect(rows[1]).toEqual(["c1", "5"]);
  });

  it("calls through a declared SUT property", async () => {
    class Service {
      ping(): string {
        return "pong";
      }
    }

    class SutFixture {
      service = new Service();
      sut = { ping: (): string => "conventional" };
    }
    defineFixture(SutFixture, { sut: "service" });

    const { executor, register } = setup();
    register("SutFixture", SutFixture);

    const rows = await run(executor, [
      ["m1", "make", "f", "SutFixture"],
      ["c1", "call", "f", "ping"],
    ]);

    expect(rows[1]).toEqual(["c1", "pong"]);
  });

  it("calls a factory export instead of constructing it", async () => {
    let built = 0;
    const counterFactory = (): { increment: () => number } => {
      built += 1;
      let count = 0;
      return { increment: (): number => (count += 1) };
    };
    defineFixture(counterFactory, { factory: true });

    const { executor, register } = setup();
    register("CounterFactory", counterFactory);

    const rows = await run(executor, [
      ["m1", "make", "c", "CounterFactory"],
      ["c1", "call", "c", "increment"],
      ["c2", "call", "c", "increment"],
    ]);

    expect(rows.map((row) => row[1])).toEqual(["OK", "1", "2"]);
    expect(built).toBe(1);
  });

  it("uses the declared return type's converter when rendering", async () => {
    class CustomDateConverter implements Converter<Date> {
      toSlim(): string {
        return "custom-date";
      }

      fromSlim(): Date {
        return new Date(0);
      }
    }

    class DateFixture {
      today(): Date {
        return new Date(Date.UTC(2009, 4, 5));
      }
    }
    defineFixture(DateFixture, { methods: { today: { returns: Date } } });

    const { executor, register } = setup();
    register("DateFixture", DateFixture);

    const previous = defaultConverterRegistry.get(Date);
    defaultConverterRegistry.register(Date, new CustomDateConverter());
    try {
      const rows = await run(executor, [
        ["m1", "make", "d", "DateFixture"],
        ["c1", "call", "d", "today"],
      ]);

      expect(rows[1]).toEqual(["c1", "custom-date"]);
    } finally {
      defaultConverterRegistry.register(Date, previous as Converter<Date>);
    }
  });

  it("reports a missing converter for a declared parameter type", async () => {
    class UnknownFixture {
      echo(value: string): string {
        return value;
      }
    }
    defineFixture(UnknownFixture, { methods: { echo: { params: ["nope" as never] } } });

    const { executor, register } = setup();
    register("UnknownFixture", UnknownFixture);

    const rows = await run(executor, [
      ["m1", "make", "u", "UnknownFixture"],
      ["c1", "call", "u", "echo", "x"],
    ]);

    expect(String(rows[1]?.[1])).toContain("NO_CONVERTER_FOR_ARGUMENT_NUMBER");
  });
});
