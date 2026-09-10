// The file is named after the fixture name declared below, not after the class.
// `FixtureMeta.name` is what makes `|make|x|MyAlias|` resolve to `TempConv`.
import { defineFixture } from "../../../src/index.js";

export class TempConv {
  toFahrenheit(celsius) {
    return Number(celsius) * 1.8 + 32;
  }
}

defineFixture(TempConv, { name: "MyAlias" });
