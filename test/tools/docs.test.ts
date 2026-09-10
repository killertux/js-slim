import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Documentation guards.
 *
 * The README and `docs/` are the user-facing contract, so they are checked like
 * code: relative links must resolve, and every name a code block imports from
 * the package must actually be exported by `src/index.ts`.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "docs");
const PACKAGE_NAME = "@killertux/js-slim";

/** The shipped markdown files, README first. */
const MARKDOWN_FILES = [
  join(REPO_ROOT, "README.md"),
  ...readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(DOCS_DIR, name)),
];

function markdown(path: string): string {
  return readFileSync(path, "utf8");
}

/** Fenced code blocks, as `{ language, code }`. */
function codeBlocks(text: string): { language: string; code: string }[] {
  return [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((match) => ({
    language: match[1] ?? "",
    code: match[2] ?? "",
  }));
}

/** Every name exported by the public barrel (values and types). */
function exportedNames(): Set<string> {
  const source = readFileSync(join(REPO_ROOT, "src", "index.ts"), "utf8");
  const names = new Set<string>();

  // export { a, b } from "…" / export type { a } from "…"
  for (const clause of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const entry of (clause[1] ?? "").split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name !== undefined && name.length > 0) {
        names.add(name);
      }
    }
  }

  // export const|class|function|interface|type|enum NAME
  for (const declaration of source.matchAll(
    /export\s+(?:const|class|function|interface|type|enum)\s+(\w+)/g,
  )) {
    names.add(declaration[1] as string);
  }

  return names;
}

describe("documentation", () => {
  it("covers the shipped markdown files", () => {
    expect(MARKDOWN_FILES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(MARKDOWN_FILES)("has no broken relative link in %s", (path) => {
    const broken: string[] = [];

    for (const match of markdown(path).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = (match[1] ?? "").trim();
      if (/^(https?:|mailto:|#)/.test(target)) {
        continue;
      }
      const withoutAnchor = target.split("#")[0] as string;
      if (withoutAnchor.length === 0) {
        continue;
      }
      const resolved = resolve(dirname(path), withoutAnchor);
      if (!existsSync(resolved)) {
        broken.push(`${target} -> ${resolved}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it.each(MARKDOWN_FILES)("only imports real exports in %s", (path) => {
    const exported = exportedNames();
    const unknown: string[] = [];

    for (const block of codeBlocks(markdown(path))) {
      for (const match of block.code.matchAll(
        new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+"${PACKAGE_NAME}"`, "g"),
      )) {
        for (const entry of (match[1] ?? "").split(",")) {
          // `import { type Foo, bar as baz }` -> compare the imported name.
          const name = entry
            .replace(/^\s*type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (name !== undefined && name.length > 0 && !exported.has(name)) {
            unknown.push(name);
          }
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  it("has a package name and version that match package.json", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const readme = markdown(join(REPO_ROOT, "README.md"));

    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(readme).toContain(pkg.name);
  });

  it("documents the Node floor it declares in package.json", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      engines: { node: string };
    };
    const floor = pkg.engines.node.replace(/^[>=^~\s]+/, "");

    expect(markdown(join(REPO_ROOT, "README.md"))).toContain(`Node.js \`>= ${floor}\``);
  });
});
