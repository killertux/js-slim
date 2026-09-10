/**
 * A typed fixture declared with decorators (TypeScript).
 *
 * Published code imports the library by name:
 *
 * ```ts
 * import { listOf, slimFixture, slimMethod } from "@killertux/js-slim";
 * ```
 *
 * The relative import below keeps this example runnable from a checkout.
 *
 * The fixture declares only what the runtime cannot work out for itself: the
 * FitNesse-facing fixture name, which property holds the System Under Test, and
 * the SLiM type of every parameter and return value. Everything else follows
 * from the method signatures.
 */

import { listOf, slimFixture, slimMethod } from "../src/index.js";

/** The System Under Test. Plain TypeScript — it knows nothing about SLiM. */
export class Calculator {
  private total = 0;

  add(value: number): number {
    this.total += value;
    return this.total;
  }

  sumOf(values: readonly number[]): number {
    return values.reduce((running, value) => running + value, 0);
  }
}

/**
 * `|make|calc|TypedCalculator|` then:
 *
 * | `|call|calc|add|5|`          | adds one number            |
 * | `|call|calc|sum of|1,2,3|`   | `listOf(Number)` → `[1,2,3]` |
 */
@slimFixture({ name: "TypedCalculator", sut: "calculator" })
export class TypedCalculatorFixture {
  readonly calculator = new Calculator();

  @slimMethod({ params: [Number], returns: Number })
  add(value: number): number {
    return this.calculator.add(value);
  }

  /** `"sum of"` is not a valid JavaScript name, so the alias is declared. */
  @slimMethod({ name: "sum of", params: [listOf(Number)], returns: Number })
  sumOf(values: number[]): number {
    return this.calculator.sumOf(values);
  }
}
