import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";

/**
 * A loadable fixture: any function (class or constructor function) that the
 * executor can `new`. Parameter types are checked at call time (step 9).
 */
export type FixtureConstructor = new (...args: never[]) => unknown;

/** Hook tried before filesystem/package resolution (e.g. an explicit registry). */
export type FixtureResolver = (className: string) => FixtureConstructor | undefined;

/** Imports a module specifier; injectable for tests. */
export type FixtureImporter = (specifier: string) => Promise<unknown>;

export interface FixtureLoaderOptions {
  /** Optional resolver tried before anything else. */
  resolver?: FixtureResolver;
  /** File extensions to try, in order. */
  extensions?: readonly string[];
  /** Module importer. Defaults to dynamic `import()`. */
  importer?: FixtureImporter;
  /** File existence check. Defaults to `fs.existsSync`. */
  fileExists?: (path: string) => boolean;
  /** Base directory for relative import paths. Defaults to `process.cwd()`. */
  cwd?: string;
}

const DEFAULT_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"] as const;

const nativeImport: FixtureImporter = (specifier) => import(/* @vite-ignore */ specifier);

/**
 * A dynamic import that works from both output formats.
 *
 * TypeScript downlevels `import()` to `require()` under `module: commonjs`,
 * which cannot load ESM fixtures, so the CommonJS build evaluates `import`
 * instead. `__filename` is undefined in ESM output, which selects the native
 * (statically analysable) import there.
 */
const dynamicImport: FixtureImporter =
  typeof __filename === "undefined"
    ? nativeImport
    : (new Function("specifier", "return import(specifier)") as FixtureImporter);

interface Candidate {
  readonly specifier: string;
  /** Filesystem path to check first, or `null` for package specifiers. */
  readonly filePath: string | null;
  readonly exportPath: readonly string[];
}

/**
 * Resolves fixture class names to constructors.
 *
 * `import` paths are search roots (a directory, a module file, or a package
 * specifier) and are searched most-recent-first, like the Java classpath. For a
 * dotted class name such as `eg.Division`, the loader tries nested
 * (`…/eg/Division.js`), flattened (`…/eg.Division.js`) and namespaced
 * (`…/eg.js` exporting `Division`) layouts.
 */
export class FixtureLoader {
  private readonly searchPaths: string[] = [];
  private readonly moduleCache = new Map<string, Promise<unknown | null>>();
  private readonly resolver: FixtureResolver | undefined;
  private readonly extensions: readonly string[];
  private readonly importer: FixtureImporter;
  private readonly fileExists: (path: string) => boolean;
  private readonly cwd: string;

  constructor(options: FixtureLoaderOptions = {}) {
    this.resolver = options.resolver;
    this.extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    this.importer = options.importer ?? dynamicImport;
    this.fileExists = options.fileExists ?? existsSync;
    this.cwd = options.cwd ?? process.cwd();
  }

  /** Add an import path. Later additions take precedence; duplicates are ignored. */
  addPath(path: string): void {
    if (this.searchPaths.includes(path)) {
      return;
    }
    this.searchPaths.unshift(path);
  }

  /** The configured import paths, most-recent first. */
  get paths(): readonly string[] {
    return [...this.searchPaths];
  }

  /**
   * Resolve a class name to a fixture constructor.
   *
   * @throws {SlimError} tagged `NO_CLASS` when nothing matches.
   */
  async load(className: string): Promise<FixtureConstructor> {
    const custom = this.resolver?.(className);
    if (custom !== undefined) {
      return custom;
    }

    // Exact name first across all roots, then the swap-case variant (Java parity).
    for (const name of [className, swapCaseOfFirstLetter(className)]) {
      for (const root of this.searchPaths) {
        const found = await this.resolveFromRoot(root, name);
        if (found !== undefined) {
          return found;
        }
      }

      const fromPackage = await this.resolveAsPackage(name);
      if (fromPackage !== undefined) {
        return fromPackage;
      }
    }

    throw new SlimError(formatSlimMessage(`${className}.`, SLIM_ERROR.NO_CLASS), {
      tag: SLIM_ERROR.NO_CLASS,
    });
  }

  private async resolveFromRoot(
    root: string,
    className: string,
  ): Promise<FixtureConstructor | undefined> {
    for (const candidate of this.candidatesFor(root, className)) {
      const fixture = await this.tryCandidate(candidate);
      if (fixture !== undefined) {
        return fixture;
      }
    }
    return undefined;
  }

  private async resolveAsPackage(className: string): Promise<FixtureConstructor | undefined> {
    const segments = className.split(".");
    for (const exportPath of [[], segments, ["default", ...segments]]) {
      const fixture = await this.tryCandidate({
        specifier: className,
        filePath: null,
        exportPath,
      });
      if (fixture !== undefined) {
        return fixture;
      }
    }
    return undefined;
  }

  private candidatesFor(root: string, className: string): Candidate[] {
    const segments = className.split(".");
    const seen = new Set<string>();
    const candidates: Candidate[] = [];

    const push = (candidate: Candidate): void => {
      const key = `${candidate.specifier}\u0000${candidate.exportPath.join(".")}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    };

    const file = (path: string, exportPath: readonly string[]): void => {
      push({ specifier: pathToFileURL(path).href, filePath: path, exportPath });
    };

    if (!isFileSystemPath(root)) {
      push({ specifier: root, filePath: null, exportPath: segments });
      push({ specifier: root, filePath: null, exportPath: [] });
      push({ specifier: root, filePath: null, exportPath: ["default", ...segments] });
      return candidates;
    }

    const base = isAbsolute(root) ? root : resolve(this.cwd, root);

    // (a) The root itself is a module file.
    file(base, segments);
    file(base, []);
    file(base, ["default", ...segments]);
    for (const extension of this.extensions) {
      file(`${base}${extension}`, segments);
      file(`${base}${extension}`, []);
      file(`${base}${extension}`, ["default", ...segments]);
    }

    // (b) The root is a directory; the class name maps to a file.
    for (const extension of this.extensions) {
      const nested = `${join(base, ...segments)}${extension}`;
      file(nested, []);
      file(nested, segments);
      file(nested, ["default", ...segments]);

      if (segments.length > 1) {
        const flattened = `${join(base, segments.join("."))}${extension}`;
        file(flattened, []);
        file(flattened, segments);
        file(flattened, ["default", ...segments]);
      }
    }

    // (c) The root is a directory; leading segments name a module, the rest its exports.
    for (let index = 1; index < segments.length; index += 1) {
      const head = segments.slice(0, index);
      const tail = segments.slice(index);
      for (const extension of this.extensions) {
        const nested = `${join(base, ...head)}${extension}`;
        file(nested, tail);
        file(nested, ["default", ...tail]);
        if (head.length > 1) {
          file(`${join(base, head.join("."))}${extension}`, tail);
        }
      }
    }

    return candidates;
  }

  private async tryCandidate(candidate: Candidate): Promise<FixtureConstructor | undefined> {
    if (candidate.filePath !== null && !this.fileExists(candidate.filePath)) {
      return undefined;
    }

    const namespace = await this.importModule(candidate.specifier);
    if (namespace === null) {
      return undefined;
    }

    const value = resolveExport(namespace, candidate.exportPath);
    return typeof value === "function" ? (value as FixtureConstructor) : undefined;
  }

  private importModule(specifier: string): Promise<unknown | null> {
    let cached = this.moduleCache.get(specifier);
    if (cached === undefined) {
      cached = this.importer(specifier).catch(() => null);
      this.moduleCache.set(specifier, cached);
    }
    return cached;
  }
}

/** Swap the case of the first character, e.g. `myFixture` → `MyFixture`. */
export function swapCaseOfFirstLetter(value: string): string {
  if (value.length === 0) {
    return value;
  }
  const first = value.charAt(0);
  const swapped = first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase();
  return `${swapped}${value.slice(1)}`;
}

function resolveExport(namespace: unknown, exportPath: readonly string[]): unknown {
  if (namespace === null || namespace === undefined) {
    return undefined;
  }
  if (exportPath.length === 0) {
    return (namespace as { default?: unknown }).default;
  }

  let current: unknown = namespace;
  for (const key of exportPath) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isFileSystemPath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}
