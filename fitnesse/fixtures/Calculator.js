/**
 * Plain JavaScript fixture for the FitNesse acceptance suite.
 *
 * It deliberately imports nothing: arguments are smart-coerced (FitNesse sends
 * cells as strings, so `"2"` arrives as the number `2`) and `add` takes rest
 * arguments so it accepts any number of cells.
 */
export class Calculator {
  #total = 0;
  #a = 0;
  #b = 0;

  reset() {
    this.#total = 0;
    this.#a = 0;
    this.#b = 0;
  }

  /** Decision-table input; also proves `setX` naming. */
  setA(value) {
    this.#a = Number(value);
  }

  setB(value) {
    this.#b = Number(value);
  }

  /** Decision-table output. */
  sum() {
    return this.#a + this.#b;
  }

  add(...values) {
    this.#total += values.reduce((running, value) => running + Number(value), 0);
    return this.#total;
  }

  total() {
    return this.#total;
  }

  /** Writes to the console so the suite proves fixture output is tunneled. */
  shout() {
    console.log("js-slim-e2e-tunnel-marker");
  }
}
