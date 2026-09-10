import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // End-to-end suites require FitNesse + a JDK and run via a dedicated
    // config/script (see step 13 of PLAN.md); keep them out of the unit run.
    exclude: ["test/e2e/**", "node_modules/**", "dist/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
