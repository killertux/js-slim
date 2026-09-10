// A fixture export that is a factory function: `factory: true` makes the
// runtime call it instead of constructing it.
import { defineFixture } from "../../../src/index.js";

class Counter {
  #count = 0;

  increment() {
    this.#count += 1;
    return this.#count;
  }
}

export function CounterFactory() {
  return new Counter();
}

defineFixture(CounterFactory, { factory: true });
