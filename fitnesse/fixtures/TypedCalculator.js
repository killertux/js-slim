/**
 * A fixture declared with the typed authoring API, used by the acceptance suite
 * to prove that metadata works in a real FitNesse run.
 *
 * The import points at the *built* library because the CLI loads fixtures with
 * plain Node; `scripts/run-fitnesse.mjs` builds before running.
 */
import { fixture, listOf } from "../../dist/esm/index.js";

class TypedCalculator {
  #total = 0;

  reset() {
    this.#total = 0;
  }

  sumOf(values) {
    this.#total = values.reduce((running, value) => running + value, 0);
    return this.#total;
  }

  total() {
    return this.#total;
  }
}

export default fixture({
  class: TypedCalculator,
  name: "TypedCalculator",
  methods: {
    // A wire name that is not a valid JavaScript identifier...
    sumOf: { name: "sum of", params: [listOf(Number)], returns: Number },
    // ...and a declared return type.
    total: { returns: Number },
  },
});
