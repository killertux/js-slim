import { describe, expect, it } from "vitest";

import {
  DEFAULT_MINIMUM_ASSERTIONS,
  TUNNEL_MARKER,
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

describe("parseResultsXml", () => {
  it("counts assertion statuses per page", () => {
    const xml = resultXml({ statuses: ["pass", "pass", "fail", "error"] });

    expect(parseResultsXml(xml)).toEqual([
      {
        rootPath: "Suite.Page",
        exitCode: "0",
        stdOut: "",
        stdErr: "",
        pass: 2,
        fail: 1,
        error: 1,
        assertions: 4,
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
  const green = parseResultsXml(
    resultXml({ statuses: Array(12).fill("pass"), stdOut: TUNNEL_MARKER }),
  );

  it("accepts a green run", () => {
    const { totals, problems } = evaluateRun({ pages: green, fitNesseExitCode: 0 });

    expect(problems).toEqual([]);
    expect(totals).toEqual({ pass: 12, fail: 0, error: 0 });
  });

  it("reports failures and exceptions", () => {
    const pages = parseResultsXml(
      resultXml({ statuses: ["pass", "fail", "error"], stdOut: TUNNEL_MARKER }),
    );

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 2 });

    expect(problems).toEqual([
      "FitNesse exited with code 2",
      "only 1 assertion(s) passed; expected at least 10",
      "1 assertion(s) failed",
      "1 assertion(s) raised an exception",
    ]);
  });

  it("fails when nothing ran, so an empty run cannot look green", () => {
    const { problems } = evaluateRun({
      pages: parseResultsXml(""),
      fitNesseExitCode: 0,
      minimumAssertions: 2,
    });

    expect(problems).toContain("FitNesse produced no test results");
    expect(problems).toContain("only 0 assertion(s) passed; expected at least 2");
  });

  it("fails when the tunneled fixture output never arrived", () => {
    const pages = parseResultsXml(resultXml({ statuses: Array(12).fill("pass") }));

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 0 });

    expect(problems).toEqual([`tunneled fixture output (${TUNNEL_MARKER}) never reached FitNesse`]);
  });

  it("can skip the tunnel check", () => {
    const pages = parseResultsXml(resultXml({ statuses: Array(12).fill("pass") }));

    expect(evaluateRun({ pages, fitNesseExitCode: 0, marker: null }).problems).toEqual([]);
  });

  it("requires a minimum number of assertions by default", () => {
    const pages = parseResultsXml(resultXml({ statuses: ["pass"], stdOut: TUNNEL_MARKER }));

    const { problems } = evaluateRun({ pages, fitNesseExitCode: 0 });

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

  it("rejects unknown flags and missing values", () => {
    expect(() => parseArguments(["--nope", "x"])).toThrow(/Unknown option/);
    expect(() => parseArguments(["--jar"])).toThrow(/Missing value/);
  });
});
