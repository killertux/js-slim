import { describe, expect, it } from "vitest";

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
