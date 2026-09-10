import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SLIM_ERROR, SlimError } from "../../src/errors.js";
import {
  FixtureLoader,
  swapCaseOfFirstLetter,
  type FixtureLoaderOptions,
} from "../../src/runtime/fixture-loader.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));

// The default importer is format-selected (evaluated `import` under CommonJS);
// tests use the native one so Vitest can resolve the fixture modules.
const nativeImport = (specifier: string) => import(specifier);

function makeLoader(options: FixtureLoaderOptions = {}): FixtureLoader {
  return new FixtureLoader({ cwd: FIXTURES, importer: nativeImport, ...options });
}

function fixturesLoader(): FixtureLoader {
  const loader = makeLoader();
  loader.addPath(FIXTURES);
  return loader;
}

describe("swapCaseOfFirstLetter", () => {
  it("swaps the case of the first character", () => {
    expect(swapCaseOfFirstLetter("myFixture")).toBe("MyFixture");
    expect(swapCaseOfFirstLetter("MyFixture")).toBe("myFixture");
    expect(swapCaseOfFirstLetter("")).toBe("");
  });
});

describe("FixtureLoader", () => {
  it("loads a default-exported class from a directory", async () => {
    const fixture = await fixturesLoader().load("HelloFixture");
    expect(typeof fixture).toBe("function");
    expect(fixture.name).toBe("HelloFixture");
  });

  it("loads a named export from a directory file", async () => {
    expect((await fixturesLoader().load("DirectNamed")).name).toBe("DirectNamed");
  });

  it("resolves a relative import path against cwd", async () => {
    const loader = makeLoader();
    loader.addPath(".");
    expect((await loader.load("HelloFixture")).name).toBe("HelloFixture");
  });

  it("loads a class from a nested directory", async () => {
    expect((await fixturesLoader().load("eg.Division")).name).toBe("Division");
  });

  it("loads a class from a flattened file", async () => {
    expect((await fixturesLoader().load("flat.Doubled")).name).toBe("Doubled");
  });

  it("resolves a namespace module's export path", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "namespaced.js"));
    expect((await loader.load("eg.Division")).name).toBe("Division");
  });

  it("loads named exports from a module file", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "multiple.js"));
    expect((await loader.load("First")).name).toBe("First");
    expect((await loader.load("Second")).name).toBe("Second");
  });

  it("loads CommonJS fixtures", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "legacy.cjs"));
    expect((await loader.load("Legacy")).name).toBe("Legacy");
  });

  it("falls back to swapping the first letter's case", async () => {
    expect((await fixturesLoader().load("SwapMe")).name).toBe("SwapMe");
  });

  it("gives later import paths precedence", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "first"));
    loader.addPath(join(FIXTURES, "second"));
    expect((await loader.load("Shared")).name).toBe("SharedSecond");
  });

  it("only keeps each import path once, most-recent first", () => {
    const loader = new FixtureLoader();
    loader.addPath("/a");
    loader.addPath("/b");
    loader.addPath("/a");
    expect(loader.paths).toEqual(["/b", "/a"]);
  });

  it("uses a custom resolver first", async () => {
    class Stub {}
    const loader = makeLoader({ resolver: (name) => (name === "Stub" ? Stub : undefined) });
    expect(await loader.load("Stub")).toBe(Stub);
  });

  it("falls through when the resolver declines", async () => {
    const loader = makeLoader({ resolver: () => undefined });
    loader.addPath(FIXTURES);
    expect((await loader.load("HelloFixture")).name).toBe("HelloFixture");
  });

  it("throws NO_CLASS when nothing matches", async () => {
    await expect(fixturesLoader().load("NoSuchFixture")).rejects.toThrow(SlimError);

    try {
      await fixturesLoader().load("NoSuchFixture");
      throw new Error("expected load to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SlimError);
      expect((error as SlimError).tag).toBe(SLIM_ERROR.NO_CLASS);
      expect((error as SlimError).message).toBe("message:<<NO_CLASS NoSuchFixture.>>");
    }
  });

  it("tries .ts candidates when no .js file exists", async () => {
    const requested: string[] = [];
    const loader = makeLoader({
      cwd: "/root",
      fileExists: (path) => path.endsWith("TsFixture.ts"),
      importer: async (specifier) => {
        requested.push(specifier);
        return { default: class TsFixture {} };
      },
    });
    loader.addPath("/root");

    expect((await loader.load("TsFixture")).name).toBe("TsFixture");
    expect(requested.some((specifier) => specifier.endsWith("TsFixture.ts"))).toBe(true);
  });

  it("treats a non-path import as a package specifier", async () => {
    const seen: string[] = [];
    const loader = makeLoader({
      importer: async (specifier) => {
        seen.push(specifier);
        return { eg: { Division: class Division {} } };
      },
    });
    loader.addPath("some-package");

    expect((await loader.load("eg.Division")).name).toBe("Division");
    expect(seen).toContain("some-package");
  });

  it("falls back to the class name as a module specifier", async () => {
    const loader = makeLoader({
      importer: async () => ({ default: class Packaged {} }),
    });
    expect((await loader.load("Packaged")).name).toBe("Packaged");
  });

  it("skips a module that fails to import and tries the next candidate", async () => {
    const loader = makeLoader({
      cwd: "/root",
      fileExists: (path) => path.endsWith("Broken.js") || path.endsWith("Broken.mjs"),
      importer: async (specifier) => {
        if (specifier.endsWith("Broken.js") || specifier === "Broken") {
          throw new Error("boom");
        }
        return { default: class Fallback {} };
      },
    });
    loader.addPath("/root");

    expect((await loader.load("Broken")).name).toBe("Fallback");
  });
});
