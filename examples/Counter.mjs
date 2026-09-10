/**
 * A typed fixture declared without decorators (plain JavaScript).
 *
 * Published code imports the library by name:
 *
 * ```js
 * import { fixture } from "@killertux/js-slim";
 * ```
 *
 * The relative import below keeps this example runnable from a checkout.
 *
 * `fixture()` attaches the same metadata the decorators do and returns the
 * class, so the export is still a normal fixture class. The file is named after
 * the FitNesse fixture name (`Counter`), which is how the loader finds it.
 */

import { fixture } from "../src/index.js";

class Counter {
  #count = 0;

  increment(by) {
    this.#count += Number(by);
    return this.#count;
  }
}

export default fixture({
  class: Counter,
  name: "Counter",
  methods: {
    increment: { params: [Number], returns: Number },
  },
});
