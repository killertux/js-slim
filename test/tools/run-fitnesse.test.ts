import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPECTED_PAGES,
  DEFAULT_MINIMUM_ASSERTIONS,
  TUNNEL_MARKER,
  TUNNEL_MARKER_PAGE,
  evaluateRun,
  parseArguments,
  parseResultsXml,
} from "../../scripts/run-fitnesse.mjs";

/** One FitNesse result document, with the parts the runner reads. */
function resultXml({
  rootPath = "Suite.Page",
  statuses = ["pass"],
  exitCode = "0",
  stdOut = "",
}: {
  rootPath?: string;
  statuses?: string[];
  exitCode?: string;
  stdOut?: string;
} = {}): string {
  const expectations = statuses
    .map(
      (status) =>
        `      <instructionResult>\n        <expectation>\n          <status>${status}</status>\n        </expectation>\n      </instructionResult>`,
    )
    .join("\n");

  return `<testResults>
  <rootPath>${rootPath}</rootPath>
  <instructions>
${expectations}
  </instructions>
  <executionLog>
    <exitCode>${exitCode}</exitCode>
    <stdOut>${stdOut}</stdOut>
    <stdErr></stdErr>
  </executionLog>
</testResults>`;
}

/** A page that satisfies the default expectations: enough passes plus the marker. */
function passingPage(rootPath = TUNNEL_MARKER_PAGE): string {
  return resultXml({
    rootPath,
    statuses: Array(12).fill("pass"),
    stdOut: TUNNEL_MARKER,
  });
}

describe("parseResultsXml", () => {
  it("counts assertion statuses per page", () => {
    const xml = resultXml({ statuses: ["pass", "pass", "fail", "error", "ignore"] });

    expect(parseResultsXml(xml)).toEqual([
      {
        rootPath: "Suite.Page",
        exitCode: "0",
        stdOut: "",
        stdErr: "",
        pass: 2,
        fail: 1,
        error: 1,
        ignore: 1,
        assertions: 5,
      },
    ]);
  });

  it("handles several documents and XML entities", () => {
    const xml = `${resultXml({ rootPath: "Suite.One" })}${resultXml({
      rootPath: "Suite.Two",
      statuses: ["pass"],
      stdOut: "&lt;marker&gt;",
    })}`;

    const pages = parseResultsXml(xml);

    expect(pages.map((page) => page.rootPath)).toEqual(["Suite.One", "Suite.Two"]);
    expect(pages[1]?.stdOut).toBe("<marker>");
  });

  it("returns nothing for output without results", () => {
    expect(parseResultsXml("no results here")).toEqual([]);
  });
});

describe("evaluateRun", () => {
  const singlePage = { expectedPages: ["Suite.Page"] };

  it("accepts a green run", () => {
    const pages = parseResultsXml(passingPage("Suite.Page"));
    const { totals, problems } = evaluateRun({ pages, fitNesseExitCode: 0, ...singlePage });

    expect(problems).toEqual([]);
    expect(totals).toEqual({ pass: 12, fail: 0, error: 0, ignore: 0 });
  });

  it("accepts a green run against the default expectations", () => {
    const pages = parseResultsXml(DEFAULT_EXPECTED_PAGES.map((page) => passingPage(page)).join(""));

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 0 });

    expect(problems).toEqual([]);
  });

  it("reports failures, exceptions and ignores", () => {
    const pages = parseResultsXml(
      resultXml({ rootPath: "Suite.Page", statuses: ["pass", "fail", "error", "ignore"] }),
    );

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 2, ...singlePage });

    expect(problems).toEqual([
      "FitNesse exited with code 2",
      "only 1 assertion(s) passed; expected at least 10",
      "1 assertion(s) failed",
      "1 assertion(s) raised an exception",
      "1 assertion(s) were ignored",
    ]);
  });

  // The regression this guards: one page alone clears the assertion floor, so a
  // page that stops running would otherwise look green.
  it("fails when an expected page did not run", () => {
    const pages = parseResultsXml(passingPage("JsSlimSuite.SmokeTest"));

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 0 });

    expect(problems).toEqual(["expected page JsSlimSuite.PipeMode did not run"]);
  });

  it("fails when every expected page is missing", () => {
    const { problems } = evaluateRun({ pages: parseResultsXml(""), fitNesseExitCode: 0 });

    expect(problems).toContain("FitNesse produced no test results");
    for (const page of DEFAULT_EXPECTED_PAGES) {
      expect(problems).toContain(`expected page ${page} did not run`);
    }
  });

  it("fails when the marker arrives on the wrong page only", () => {
    // The marker must come from the pipe-mode page: only stdin/stdout mode
    // patches process output, so a marker elsewhere proves nothing about the tunnel.
    const pages = parseResultsXml(
      [
        passingPage("JsSlimSuite.SmokeTest"),
        resultXml({ rootPath: TUNNEL_MARKER_PAGE, statuses: Array(4).fill("pass") }),
      ].join(""),
    );

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 0 });

    expect(problems).toContain(
      `pipe-mode fixture output (${TUNNEL_MARKER}) never reached FitNesse for ${TUNNEL_MARKER_PAGE}`,
    );
  });

  it("can skip the marker check", () => {
    const pages = parseResultsXml(
      resultXml({ rootPath: "Suite.Page", statuses: Array(12).fill("pass") }),
    );

    expect(
      evaluateRun({ pages, fitNesseExitCode: 0, marker: null, ...singlePage }).problems,
    ).toEqual([]);
  });

  it("requires a minimum number of assertions by default", () => {
    const pages = parseResultsXml(
      resultXml({ rootPath: "Suite.Page", statuses: ["pass"], stdOut: TUNNEL_MARKER }),
    );

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 0, ...singlePage });

    expect(problems).toEqual([
      `only 1 assertion(s) passed; expected at least ${DEFAULT_MINIMUM_ASSERTIONS}`,
    ]);
  });
});

describe("parseArguments", () => {
  it("parses the supported flags", () => {
    const options = parseArguments([
      "--jar",
      "/tmp/fitnesse.jar",
      "--java",
      "/jdk17/bin/java",
      "--page",
      "Suite?suite",
      "--port",
      "9125",
      "--minimum-assertions",
      "3",
    ]);

    expect(options).toMatchObject({
      jar: "/tmp/fitnesse.jar",
      java: "/jdk17/bin/java",
      page: "Suite?suite",
      port: 9125,
      minimumAssertions: 3,
    });
  });

  it("reports unknown flags as unknown, not as a missing value", () => {
    expect(() => parseArguments(["--nope"])).toThrow(/Unknown option: --nope/);
    expect(() => parseArguments(["--jar"])).toThrow(/Missing value for --jar/);
  });

  it("rejects non-numeric and out-of-range numbers", () => {
    expect(() => parseArguments(["--port", "abc"])).toThrow(/Invalid value for --port/);
    expect(() => parseArguments(["--port", "0"])).toThrow(/Invalid value for --port/);
    expect(() => parseArguments(["--port", "70000"])).toThrow(/Invalid value for --port/);
    expect(() => parseArguments(["--minimum-assertions", "1.5"])).toThrow(
      /Invalid value for --minimum-assertions/,
    );
  });
});
