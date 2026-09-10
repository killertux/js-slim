import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, TUNNEL_MARKER, runFitnesse } from "../../scripts/run-fitnesse.mjs";

/**
 * The committed FitNesse wiki suite, run against the built CLI.
 *
 * Needs a JDK 11+ on `PATH` (or `FITNESSE_JAVA`), a pinned
 * `fitnesse-standalone.jar` (`FITNESSE_JAR`) and `pnpm build`. Run it with
 * `pnpm test:e2e`; the default `pnpm test` run excludes this directory because
 * none of that is available in a plain unit-test environment.
 */
const JAR = process.env.FITNESSE_JAR ?? "";
const CLI = join(REPO_ROOT, "dist", "esm", "cli.js");
const READY = JAR !== "" && existsSync(JAR) && existsSync(CLI);

describe.skipIf(!READY)("FitNesse acceptance suite", () => {
  it("passes the committed wiki suite against the built CLI", async () => {
    // Captured rather than streamed: FitNesse prints a full HTML page per run,
    // so only the summary (and, on failure, the tail) is worth logging.
    const run = await runFitnesse({
      jar: JAR,
      out: join(REPO_ROOT, "fitnesse", "build", "FitNesseRoot"),
      log: () => {},
    });

    for (const page of run.pages) {
      console.log(
        `${page.rootPath}: ${page.pass} passed, ${page.fail} failed, ${page.error} exceptions`,
      );
    }

    if (run.problems.length > 0) {
      console.log("\n--- FitNesse output (tail) ---");
      console.log(run.output.split("\n").slice(-60).join("\n"));
    }

    expect(run.problems).toEqual([]);
    expect(run.totals.fail).toBe(0);
    expect(run.totals.error).toBe(0);
    // `Calculator.shout` writes to the console; both transports must carry it
    // through the output tunnel without corrupting the protocol stream.
    expect(run.pages.some((page) => page.stdOut.includes(TUNNEL_MARKER))).toBe(true);
  });
});
