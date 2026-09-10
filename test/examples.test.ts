import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TypedCalculatorFixture } from "../examples/typed-calculator.js";
import { declaredFixtureName, declaredSutName, getOwnMethodMeta } from "../src/fixture.js";
import { parseInstruction } from "../src/instructions/parse.js";
import type { SlimList } from "../src/protocol/types.js";
import { ExecutionContext } from "../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../src/runtime/fixture-loader.js";
import { StatementExecutor, type SlimRow } from "../src/runtime/statement-executor.js";

// The examples are documentation, so they are exercised here: a broken example
// fails the suite instead of misleading a reader.
const EXAMPLES = fileURLToPath(new URL("../examples", import.meta.url));
const nativeImport = (specifier: string) => import(specifier);

function executorFor(fixtures: ReadonlyMap<string, FixtureConstructor>): StatementExecutor {
  const loader = new FixtureLoader({ resolver: (name) => fixtures.get(name) });
  return new StatementExecutor({ context: new ExecutionContext({ fixtureLoader: loader }) });
}

function run(executor: StatementExecutor, rows: readonly SlimList[]): Promise<SlimRow[]> {
  return executor.executeAll(rows.map((row) => parseInstruction(row)));
}

describe("examples/typed-calculator.ts", () => {
  it("declares its fixture name and System Under Test", () => {
    expect(declaredFixtureName(TypedCalculatorFixture)).toBe("TypedCalculator");
    expect(declaredSutName(TypedCalculatorFixture)).toBe("calculator");
    // `@slimMethod` attaches metadata to the method itself.
    expect(getOwnMethodMeta(TypedCalculatorFixture.prototype.sumOf)?.name).toBe("sum of");
    expect(getOwnMethodMeta(TypedCalculatorFixture.prototype.add)?.params).toEqual([Number]);
  });

  it("runs a script table with declared types and an alias", async () => {
    const executor = executorFor(new Map([["TypedCalculator", TypedCalculatorFixture]]));

    const rows = await run(executor, [
      ["m1", "make", "calc", "TypedCalculator"],
      ["c1", "call", "calc", "add", "5"],
      ["c2", "call", "calc", "sum of", "1,2,3"],
      // Stateful: the fixture keeps its Calculator between instructions.
      ["c3", "call", "calc", "add", "2"],
    ]);

    expect(rows).toEqual([
      ["m1", "OK"],
      ["c1", "5"],
      ["c2", "6"],
      ["c3", "7"],
    ]);
  });

  it("reaches the System Under Test directly", async () => {
    const executor = executorFor(new Map([["TypedCalculator", TypedCalculatorFixture]]));

    const rows = await run(executor, [
      ["m1", "make", "calc", "TypedCalculator"],
      // `add` lives on both the fixture and the SUT; the fixture wins.
      ["c1", "call", "calc", "add", "1"],
    ]);

    expect(rows[1]).toEqual(["c1", "1"]);
  });
});

describe("examples/Counter.mjs", () => {
  it("loads the JavaScript example and uses its declared parameter types", async () => {
    const loader = new FixtureLoader({ cwd: EXAMPLES, importer: nativeImport });
    loader.addPath(EXAMPLES);

    const Counter = await loader.load("Counter");
    const executor = executorFor(new Map([["Counter", Counter]]));

    const rows = await run(executor, [
      ["m1", "make", "counter", "Counter"],
      ["c1", "call", "counter", "increment", "2"],
      ["c2", "call", "counter", "increment", "3"],
    ]);

    expect(rows).toEqual([
      ["m1", "OK"],
      ["c1", "2"],
      ["c2", "5"],
    ]);
  });
});
