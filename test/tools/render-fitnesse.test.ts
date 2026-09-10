import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { REPO_ROOT_TOKEN, parseArguments, renderWikiRoot } from "../../scripts/render-fitnesse.mjs";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "js-slim-render-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("renderWikiRoot", () => {
  it("replaces the repository token in every file, preserving the tree", async () => {
    const source = await temporaryDirectory();
    const out = join(await temporaryDirectory(), "root");
    await mkdir(join(source, "Suite", "Page"), { recursive: true });
    await writeFile(join(source, "Suite", "content.txt"), "suite at $PWD");
    await writeFile(join(source, "Suite", "Page", "content.txt"), "|import|\n|$PWD/fixtures|");
    await writeFile(join(source, "Suite", "properties.xml"), "<properties/>");

    const rendered = await renderWikiRoot({ source, out, repoRoot: "/repo" });

    expect(rendered).toHaveLength(3);
    expect(await readFile(join(out, "Suite", "content.txt"), "utf8")).toBe("suite at /repo");
    expect(await readFile(join(out, "Suite", "Page", "content.txt"), "utf8")).toBe(
      "|import|\n|/repo/fixtures|",
    );
    // Non-template files are copied verbatim.
    expect(await readFile(join(out, "Suite", "properties.xml"), "utf8")).toBe("<properties/>");
  });

  it("replaces every occurrence", async () => {
    const source = await temporaryDirectory();
    const out = join(await temporaryDirectory(), "root");
    await writeFile(join(source, "content.txt"), "$PWD $PWD");

    await renderWikiRoot({ source, out, repoRoot: "/r" });

    expect(await readFile(join(out, "content.txt"), "utf8")).toBe("/r /r");
  });

  it("clears stale output so an old page cannot be run by accident", async () => {
    const source = await temporaryDirectory();
    const out = join(await temporaryDirectory(), "root");
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "stale.txt"), "stale");
    await writeFile(join(source, "content.txt"), "fresh");

    await renderWikiRoot({ source, out, repoRoot: "/r" });

    await expect(readFile(join(out, "stale.txt"), "utf8")).rejects.toThrow();
    expect(await readFile(join(out, "content.txt"), "utf8")).toBe("fresh");
  });

  it("uses the documented token", () => {
    expect(REPO_ROOT_TOKEN).toBe("$PWD");
  });
});

describe("parseArguments", () => {
  it("parses the supported flags", () => {
    expect(parseArguments(["--out", "/tmp/wiki", "--repo-root", "/repo"])).toEqual({
      source: undefined,
      out: "/tmp/wiki",
      repoRoot: "/repo",
    });
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseArguments(["--nope", "x"])).toThrow(/Unknown option/);
    expect(() => parseArguments(["--out"])).toThrow(/Missing value/);
  });
});
