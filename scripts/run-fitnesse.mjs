#!/usr/bin/env node
/**
 * Run the committed FitNesse acceptance suite against the built CLI.
 *
 * Renders the wiki root, executes FitNesse once for the whole suite, then fails
 * unless every assertion passed, no fixture raised an exception, and FitNesse
 * captured the tunneled fixture output.
 *
 * ```sh
 * pnpm build
 * FITNESSE_JAR=/path/fitnesse-standalone.jar node scripts/run-fitnesse.mjs
 * ```
 *
 * Environment overrides: `FITNESSE_JAR`, `FITNESSE_JAVA`.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_OUT, REPO_ROOT, renderWikiRoot } from "./render-fitnesse.mjs";

/** The suite page that runs every test page. */
export const DEFAULT_PAGE = "JsSlimSuite?suite";
/** The FitNesse web port; the SLiM port is chosen by the page (`SLIM_PORT`). */
export const DEFAULT_FITNESSE_PORT = 9124;
/** Written by the `Calculator.shout` fixture through the output tunnel. */
export const TUNNEL_MARKER = "js-slim-e2e-tunnel-marker";
/** Fail if fewer assertions than this pass, so "nothing ran" cannot look green. */
export const DEFAULT_MINIMUM_ASSERTIONS = 10;

/** Decode the XML entities FitNesse writes into result files. */
function decodeXml(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** First `<tag>…</tag>` value in `xml`, decoded, or `""`. */
function tagText(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match === null ? "" : decodeXml(match[1]).trim();
}

/**
 * Parse FitNesse result XML into one entry per `<testResults>` document.
 *
 * Assertion outcomes come from the per-instruction `<status>` values: a
 * `pass`/`fail`/`error` status is written for every expectation (a `check`, a
 * decision-table output, …), while plain action rows carry no status. The
 * `<finalCounts>` element is not used — FitNesse's own summary there does not
 * match the counts it prints while running.
 *
 * @param {string} xml
 */
export function parseResultsXml(xml) {
  const pages = [];

  for (const block of xml.split("<testResults>").slice(1)) {
    const countStatus = (name) =>
      (block.match(new RegExp(`<status>${name}</status>`, "g")) ?? []).length;

    pages.push({
      rootPath: tagText(block, "rootPath"),
      exitCode: tagText(block, "exitCode"),
      stdOut: tagText(block, "stdOut"),
      stdErr: tagText(block, "stdErr"),
      pass: countStatus("pass"),
      fail: countStatus("fail"),
      error: countStatus("error"),
      assertions: (block.match(/<instructionResult>/g) ?? []).length,
    });
  }

  return pages;
}

/**
 * Decide whether a run passed.
 *
 * @param {{ pages: ReturnType<typeof parseResultsXml>, fitNesseExitCode: number,
 *   marker?: string | null, minimumAssertions?: number }} run
 * @returns {{ totals: { pass: number, fail: number, error: number }, problems: string[] }}
 */
export function evaluateRun(run) {
  const { pages, fitNesseExitCode } = run;
  const marker = run.marker === undefined ? TUNNEL_MARKER : run.marker;
  const minimumAssertions = run.minimumAssertions ?? DEFAULT_MINIMUM_ASSERTIONS;
  const problems = [];

  const totals = pages.reduce(
    (accumulated, page) => ({
      pass: accumulated.pass + page.pass,
      fail: accumulated.fail + page.fail,
      error: accumulated.error + page.error,
    }),
    { pass: 0, fail: 0, error: 0 },
  );

  if (pages.length === 0) {
    problems.push("FitNesse produced no test results");
  }
  if (fitNesseExitCode !== 0) {
    problems.push(`FitNesse exited with code ${fitNesseExitCode}`);
  }
  if (totals.pass < minimumAssertions) {
    problems.push(
      `only ${totals.pass} assertion(s) passed; expected at least ${minimumAssertions}`,
    );
  }
  if (totals.fail > 0) {
    problems.push(`${totals.fail} assertion(s) failed`);
  }
  if (totals.error > 0) {
    problems.push(`${totals.error} assertion(s) raised an exception`);
  }
  if (marker !== null && !pages.some((page) => page.stdOut.includes(marker))) {
    problems.push(`tunneled fixture output (${marker}) never reached FitNesse`);
  }

  return { totals, problems };
}

/** Every `*.xml` under `<root>/files/testResults`, deepest path last. */
async function readResultFiles(resultsDir) {
  if (!existsSync(resultsDir)) {
    return [];
  }

  const files = [];
  for (const entry of await readdir(resultsDir, { withFileTypes: true })) {
    const path = join(resultsDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readResultFiles(path)));
    } else if (entry.name.endsWith(".xml")) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Render the wiki root and run FitNesse.
 *
 * @param {{ jar: string, java?: string, page?: string, port?: number, out?: string,
 *   minimumAssertions?: number, marker?: string | null, log?: (line: string) => void }} options
 */
export async function runFitnesse(options) {
  const jar = options.jar;
  if (jar === undefined || jar === "") {
    throw new Error("FitNesse jar is required (pass --jar or set FITNESSE_JAR)");
  }
  if (!existsSync(jar)) {
    throw new Error(`FitNesse jar not found: ${jar}`);
  }

  const java = options.java ?? process.env.FITNESSE_JAVA ?? "java";
  const page = options.page ?? DEFAULT_PAGE;
  const port = options.port ?? DEFAULT_FITNESSE_PORT;
  const out = options.out ?? DEFAULT_OUT;
  const log = options.log ?? ((line) => console.log(line));

  await renderWikiRoot({ out });

  // FitNesse resolves `-r` relative to `-d`, so run from the root's parent.
  const workingDir = dirname(out);
  const resultsDir = join(out, "files", "testResults");
  await rm(resultsDir, { recursive: true, force: true });

  const args = [
    "-jar",
    resolve(jar),
    "-d",
    workingDir,
    "-r",
    basename(out),
    "-p",
    String(port),
    // `-o` omits page updates, so a run never writes page history.
    "-o",
    "-c",
    page,
  ];

  log(`Running: ${java} ${args.join(" ")}`);
  const { code, output } = await new Promise((resolvePromise, reject) => {
    const child = spawn(java, args, { cwd: workingDir });
    let output = "";
    const capture = (chunk) => {
      const text = chunk.toString("utf8");
      output += text;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, output }));
  });
  log(output.trimEnd());

  const xml = (
    await Promise.all((await readResultFiles(resultsDir)).map((path) => readFile(path, "utf8")))
  ).join("\n");
  const pages = parseResultsXml(xml);
  const { totals, problems } = evaluateRun({
    pages,
    fitNesseExitCode: code,
    ...(options.marker === undefined ? {} : { marker: options.marker }),
    ...(options.minimumAssertions === undefined
      ? {}
      : { minimumAssertions: options.minimumAssertions }),
  });

  return { pages, totals, problems, exitCode: code, output };
}

/** Parse `--flag value` style arguments. */
export function parseArguments(argv) {
  const options = { jar: process.env.FITNESSE_JAR };

  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${name}`);
    }

    switch (name) {
      case "--jar":
        options.jar = value;
        break;
      case "--java":
        options.java = value;
        break;
      case "--page":
        options.page = value;
        break;
      case "--port":
        options.port = Number(value);
        break;
      case "--out":
        options.out = value;
        break;
      case "--minimum-assertions":
        options.minimumAssertions = Number(value);
        break;
      default:
        throw new Error(`Unknown option: ${name}`);
    }
    index += 1;
  }

  return options;
}

async function main(argv) {
  const run = await runFitnesse(parseArguments(argv));

  for (const page of run.pages) {
    console.log(
      `${page.rootPath}: ${page.pass} passed, ${page.fail} failed, ${page.error} exceptions`,
    );
  }

  if (run.problems.length > 0) {
    console.error(`\nFitNesse acceptance run FAILED:`);
    for (const problem of run.problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }

  console.log(`\nFitNesse acceptance run passed (${run.totals.pass} assertions).`);
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

// `REPO_ROOT` is re-exported so callers can default paths without recomputing it.
export { REPO_ROOT };
