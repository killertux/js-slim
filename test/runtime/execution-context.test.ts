import { describe, expect, it } from "vitest";

import { SLIM_ERROR, SlimError } from "../../src/errors.js";
import { ExecutionContext } from "../../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../../src/runtime/fixture-loader.js";

class TestFixture {
  constructor(private readonly arg: string = "default") {}

  getArg(): string {
    return this.arg;
  }
}

function setup(): {
  context: ExecutionContext;
  register: (name: string, ctor: FixtureConstructor) => void;
} {
  const registry = new Map<string, FixtureConstructor>();
  const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
  return {
    context: new ExecutionContext({ fixtureLoader: loader }),
    register: (name, ctor) => registry.set(name, ctor),
  };
}

describe("ExecutionContext", () => {
  it("creates and retrieves instances", async () => {
    const { context, register } = setup();
    register("TestFixture", TestFixture);

    const instance = await context.create("testSlim", "TestFixture");
    expect(context.getInstance("testSlim")).toBe(instance);
    expect(context.tryGetInstance("testSlim")).toBe(instance);
  });

  it("passes constructor arguments", async () => {
    const { context, register } = setup();
    register("TestFixture", TestFixture);

    const instance = (await context.create("testSlim", "TestFixture", ["hello"])) as TestFixture;
    expect(instance.getArg()).toBe("hello");
  });

  it("registers names starting with library as libraries", async () => {
    const { context, register } = setup();
    register("TestFixture", TestFixture);

    const library = await context.create("libraryFoo", "TestFixture");
    expect(context.libraries).toEqual([{ instanceName: "libraryFoo", instance: library }]);
    expect(context.getInstance("libraryFoo")).toBe(library);
  });

  it("throws NO_INSTANCE for unknown names", () => {
    const { context } = setup();

    try {
      context.getInstance("missing");
      throw new Error("expected getInstance to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SlimError);
      expect((error as SlimError).tag).toBe(SLIM_ERROR.NO_INSTANCE);
      expect((error as SlimError).message).toBe("message:<<NO_INSTANCE missing>>");
    }
  });

  it("returns undefined from tryGetInstance for unknown names", () => {
    const { context } = setup();
    expect(context.tryGetInstance("missing")).toBeUndefined();
  });

  it("registers a symbol-copied instance without loading a class", async () => {
    const { context } = setup();
    const actor = { hello: () => "world" };
    context.variables.set("v", actor);

    expect(await context.create("chained", "$v")).toBe(actor);
    expect(context.getInstance("chained")).toBe(actor);
  });

  it("adds import paths with later precedence and dedup", () => {
    const { context } = setup();
    context.addPath("/a");
    context.addPath("/b");
    context.addPath("/a");

    expect(context.paths).toEqual(["/b", "/a"]);
  });

  it("replaces symbols in arguments, walking nested lists", () => {
    const { context } = setup();
    context.variables.set("v", "Bob");

    expect(context.replaceSymbols(["hi $v", ["$v"]])).toEqual(["hi Bob", ["Bob"]]);
  });
});
