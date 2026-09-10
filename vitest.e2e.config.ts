import { defineConfig } from "vitest/config";

/**
 * End-to-end suite: runs real FitNesse against the built CLI.
 *
 * Kept out of the default `vitest` run (see `vitest.config.ts`) because it needs
 * a JDK, a FitNesse jar and a build. Run it with `pnpm test:e2e` after
 * `pnpm build`, with `FITNESSE_JAR` pointing at the jar.
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    environment: "node",
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
