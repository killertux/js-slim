#!/usr/bin/env node
/**
 * Render `fitnesse/FitNesseRoot` into a runnable wiki root.
 *
 * The committed pages are *templates*: the literal token `$PWD` stands for the
 * absolute repository path, which differs per checkout. Rendering instead of
 * committing absolute paths keeps the suite portable.
 *
 * ```sh
 * node scripts/render-fitnesse.mjs                 # -> fitnesse/build/FitNesseRoot
 * node scripts/render-fitnesse.mjs --out /tmp/root
 * ```
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The token that stands for the absolute repository path. */
export const REPO_ROOT_TOKEN = "$PWD";

/** The repository root, derived from this file's location. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where rendering writes by default. */
export const DEFAULT_OUT = join(REPO_ROOT, "fitnesse", "build", "FitNesseRoot");

/**
 * Render a wiki root.
 *
 * @param {{ source?: string, out?: string, repoRoot?: string }} [options]
 * @returns {Promise<string[]>} the rendered files, in walk order
 */
export async function renderWikiRoot(options = {}) {
  const source = options.source ?? join(REPO_ROOT, "fitnesse", "FitNesseRoot");
  const out = options.out ?? DEFAULT_OUT;
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  // A stale rendered root would silently run an old page, so start clean.
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  return await renderDirectory(source, out, repoRoot);
}

/** Walk `source`, writing every text file into `out` with the token replaced. */
async function renderDirectory(source, out, repoRoot) {
  const rendered = [];

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(out, entry.name);

    if (entry.isDirectory()) {
      await mkdir(to, { recursive: true });
      rendered.push(...(await renderDirectory(from, to, repoRoot)));
      continue;
    }

    const text = await readFile(from, "utf8");
    await writeFile(to, text.replaceAll(REPO_ROOT_TOKEN, repoRoot), "utf8");
    rendered.push(to);
  }

  return rendered;
}

/** Parse `--flag value` style arguments. */
export function parseArguments(argv) {
  const options = { source: undefined, out: undefined, repoRoot: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--source" || name === "--out" || name === "--repo-root") {
      if (value === undefined) throw new Error(`Missing value for ${name}`);
      const key = name === "--repo-root" ? "repoRoot" : name.slice(2);
      options[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${name}`);
  }

  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  const rendered = await renderWikiRoot(options);
  const out = options.out ?? DEFAULT_OUT;

  console.log(`Rendered ${rendered.length} wiki file(s) to ${out}`);
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`${basename(process.argv[1])}: ${error.message}`);
      process.exitCode = 1;
    });
}
