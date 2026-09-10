import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

describe("package scaffold", () => {
  it("exposes a semver version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
