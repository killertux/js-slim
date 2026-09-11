#!/usr/bin/env node
/**
 * Verify the *packed* package the way a consumer receives it.
 *
 * `npm publish --dry-run` only lists files; this script installs the tarball
 * into a scratch project and checks that the `exports` map, the type
 * declarations and the `js-slim` bin actually work.
 *
 * ```sh
 * pnpm build && node scripts/verify-package.mjs
 * ```
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "@killertux/js-slim";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });
}

function main() {
  const failures = [];
  const check = (name, condition, detail = "") => {
    if (condition) {
      console.log(`PASS  ${name}`);
    } else {
      failures.push(name);
      console.log(`FAIL  ${name} ${detail}`);
    }
  };

  const scratch = mkdtempSync(join(tmpdir(), "js-slim-pack-"));
  try {
    const packOutput = run("npm", ["pack", "--pack-destination", scratch]).trim();
    console.log(packOutput);

    const tarball = readdirSync(scratch).find((name) => name.endsWith(".tgz"));
    if (tarball === undefined) {
      console.error("FAIL  the packer produced no tarball");
      return 1;
    }

    // A scratch consumer project to install into.
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ name: "consumer", private: true, version: "1.0.0" }, null, 2),
    );

    run("npm", ["install", join(scratch, tarball), "--no-audit", "--no-fund", "--ignore-scripts"], {
      cwd: scratch,
    });

    const installed = join(scratch, "node_modules", PACKAGE_NAME);
    check("package is installed", existsSync(installed));
    check("ESM build is present", existsSync(join(installed, "dist", "esm", "index.js")));
    check("CJS build is present", existsSync(join(installed, "dist", "cjs", "index.js")));
    check("ESM types are present", existsSync(join(installed, "dist", "esm", "index.d.ts")));
    check("CJS types are present", existsSync(join(installed, "dist", "cjs", "index.d.ts")));
    check("the CLI ships in the ESM build", existsSync(join(installed, "dist", "esm", "cli.js")));
    check(
      "the CJS build has no CLI (ESM-only bin)",
      !existsSync(join(installed, "dist", "cjs", "cli.js")),
    );

    // The `files` list also ships the docs and the changelog; a regression there
    // would otherwise only be noticed by a reader of the npm page.
    for (const relative of [
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
      "docs/fitnesse-setup.md",
      "docs/protocol-notes.md",
    ]) {
      check(`${relative} ships`, existsSync(join(installed, relative)));
    }
    check("PLAN.md is not shipped", !existsSync(join(installed, "PLAN.md")));
    check("the TypeScript sources are not shipped", !existsSync(join(installed, "src")));

    // The version in `src/index.ts` must match the published `package.json`.
    const installedVersion = JSON.parse(
      readFileSync(join(installed, "package.json"), "utf8"),
    ).version;

    // CJS consumers
    const cjs = run(
      "node",
      [
        "-e",
        `const m = require(${JSON.stringify(PACKAGE_NAME)});
         console.log(JSON.stringify({
           api: [typeof m.SlimServer, typeof m.serialize, typeof m.slimFixture, typeof m.listOf],
           version: m.VERSION,
         }));`,
      ],
      { cwd: scratch },
    ).trim();
    const cjsResult = JSON.parse(cjs);
    check(
      "require() exposes the API",
      cjsResult.api.every((entry) => entry === "function"),
      cjs,
    );
    check("VERSION matches package.json", cjsResult.version === installedVersion, cjs);

    // ESM consumers
    const esm = run(
      "node",
      [
        "--input-type=module",
        "-e",
        `import { slimFixture, defineFixture, listOf, coerceValue } from ${JSON.stringify(PACKAGE_NAME)};
         console.log([typeof slimFixture, typeof defineFixture, JSON.stringify(coerceValue("1,2", listOf(Number)))].join(" "));`,
      ],
      { cwd: scratch },
    ).trim();
    check("import exposes the API", esm === "function function [1,2]", esm);

    // The bin, through npm's shim
    const bin = join(scratch, "node_modules", ".bin", "js-slim");
    const usage = run(bin, ["-h"], { cwd: scratch });
    check("the bin prints usage", usage.includes("Usage: js-slim"));

    let badArgsExit = 0;
    try {
      run(bin, ["--nope"], { cwd: scratch });
    } catch (error) {
      badArgsExit = error.status ?? -1;
    }
    check("the bin exits 97 on bad arguments", badArgsExit === 97, `exit ${badArgsExit}`);
  } catch (error) {
    failures.push("verification threw");
    console.error(`FAIL  ${error.message}`);
    if (error.stdout) console.error(String(error.stdout));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nPackage verification FAILED (${failures.length}): ${failures.join(", ")}`);
    return 1;
  }

  console.log("\nPackage verification passed.");
  return 0;
}

process.exitCode = main();
