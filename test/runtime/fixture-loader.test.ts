import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SLIM_ERROR, SlimError } from "../../src/errors.js";
import { declaredFixtureName, isFactoryFixture } from "../../src/fixture.js";
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

  it("resolves a directory module named after the leading segment", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "nsdir"));
    expect((await loader.load("eg.Division")).name).toBe("Division");
  });

  it("loads .mjs fixtures", async () => {
    expect((await fixturesLoader().load("MjsFixture")).name).toBe("MjsFixture");
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

  it("does not satisfy an unknown class from a module-file root's default export", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "HelloFixture.js"));
    await expect(loader.load("Bogus")).rejects.toThrow(SlimError);
  });

  it("rejects class names with separators or traversal", async () => {
    await expect(fixturesLoader().load("../evil")).rejects.toThrow(SlimError);
    await expect(fixturesLoader().load("a/b")).rejects.toThrow(SlimError);
    await expect(fixturesLoader().load("a\\b")).rejects.toThrow(SlimError);
    await expect(fixturesLoader().load("")).rejects.toThrow(SlimError);
  });

  it("does not resolve inherited export paths", async () => {
    const loader = makeLoader();
    loader.addPath(join(FIXTURES, "multiple.js"));
    await expect(loader.load("constructor")).rejects.toThrow(SlimError);
    await expect(loader.load("__proto__")).rejects.toThrow(SlimError);
  });

  it("treats a null resolver result as no match", async () => {
    const loader = makeLoader({ resolver: () => null });
    loader.addPath(FIXTURES);
    expect((await loader.load("HelloFixture")).name).toBe("HelloFixture");
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
      expect((error as SlimError).message).toBe("message:<<NO_CLASS NoSuchFixture>>");
    }
  });

  it("reports a meaningful cause instead of probing a directory import path as a module", async () => {
    const error = (await fixturesLoader()
      .load("MissingClass")
      .catch((caught: unknown) => caught)) as SlimError;

    expect(error).toBeInstanceOf(SlimError);
    expect(error.tag).toBe(SLIM_ERROR.NO_CLASS);
    // The import root is a directory; before the fix the recorded cause was the
    // misleading `Directory import '…' is not supported` from probing it.
    expect(String(error.cause)).not.toContain("Directory import");
    expect(String(error.cause)).toContain("MissingClass");
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

const AUTHORING = fileURLToPath(new URL("../fixtures/authoring", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../../examples", import.meta.url));

describe("declared fixture names and factory exports", () => {
  function authoringLoader(): FixtureLoader {
    const loader = new FixtureLoader({ cwd: AUTHORING, importer: nativeImport });
    loader.addPath(AUTHORING);
    return loader;
  }

  it("resolves an export whose declared name matches the request", async () => {
    const fixture = await authoringLoader().load("MyAlias");

    expect(fixture.name).toBe("TempConv");
    expect(declaredFixtureName(fixture)).toBe("MyAlias");
  });

  it("resolves by declared name even though the class is named differently", async () => {
    // The file is `MyAlias.js`; the class inside is `TempConv`, so the declared
    // name is what makes the fixture reachable.
    await expect(authoringLoader().load("TempConv")).rejects.toThrow(/NO_CLASS TempConv/);
  });

  it("does not resolve an undeclared alias", async () => {
    await expect(authoringLoader().load("MyAlias2")).rejects.toThrow(/NO_CLASS MyAlias2/);
  });

  it("loads a factory export", async () => {
    const factory = await authoringLoader().load("CounterFactory");

    expect(isFactoryFixture(factory)).toBe(true);
    const instance = (factory as () => { increment: () => number })();
    expect(instance.increment()).toBe(1);
  });

  it("loads the JavaScript example by its fixture name", async () => {
    const loader = new FixtureLoader({ cwd: EXAMPLES, importer: nativeImport });
    loader.addPath(EXAMPLES);

    const fixture = await loader.load("Counter");
    expect(declaredFixtureName(fixture)).toBe("Counter");
  });
});
