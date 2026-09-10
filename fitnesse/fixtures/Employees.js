/**
 * Fixture for the suite's query table.
 *
 * A SLiM query table is an ordinary `call` of the fixture's `query` method. It
 * returns one entry per result row, and each row is a list of `[field, value]`
 * pairs — *not* a flat alternating list. FitNesse casts every row element to a
 * pair, so a flat row aborts the whole run with a ClassCastException.
 */
export class Employees {
  query() {
    return [
      [
        ["name", "Ada"],
        ["age", "36"],
      ],
      [
        ["name", "Grace"],
        ["age", "45"],
      ],
    ];
  }
}
