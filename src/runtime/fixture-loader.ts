import { statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";
import { declaredFixtureName, type FixtureExport } from "../fixture.js";

/**
 * A loadable fixture: a class the executor can `new`, or — when the export
 * declares `factory: true` — a function it calls instead.
 */
export type FixtureConstructor = FixtureExport;

/** Hook tried before filesystem/package resolution (e.g. an explicit registry). */
export type FixtureResolver = (className: string) => FixtureConstructor | null | undefined;

/** Imports a module specifier; injectable for tests. */
export type FixtureImporter = (specifier: string) => Promise<unknown>;

export interface FixtureLoaderOptions {
  /** Optional resolver tried before anything else. */
  resolver?: FixtureResolver;
  /** File extensions to try, in order. */
  extensions?: readonly string[];
  /** Module importer. Defaults to a format-aware dynamic import. */
  importer?: FixtureImporter;
  /** File existence check. Defaults to a regular-file check. */
  fileExists?: (path: string) => boolean;
  /** Base directory for relative import paths. Defaults to `process.cwd()`. */
  cwd?: string;
}

const DEFAULT_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"] as const;

const nativeImport: FixtureImporter = (specifier) => import(/* @vite-ignore */ specifier);

/**
 * Default existence check for module files.
 *
 * `existsSync` is not enough: an import root is frequently a *directory*, and
 * `import()`ing a directory throws `ERR_UNSUPPORTED_DIR_IMPORT`. Treating only
 * regular files as importable skips that probe and keeps the reported
 * `NO_CLASS` cause meaningful.
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

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
  /**
   * When set, the module is accepted if it exports a function declaring this
   * fixture name (see `FixtureMeta.name`) instead of by export path.
   */
  readonly declaredName?: string;
}

/**
 * Resolves fixture class names to constructors.
 *
 * `import` paths are search roots (a directory, a module file, or a package
 * specifier) and are searched most-recent-first, like the Java classpath. For a
 * dotted class name such as `eg.Division`, the loader tries nested
 * (`…/eg/Division.js`), flattened (`…/eg.Division.js`) and module-relative
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
  /** First import error seen, attached to `NO_CLASS` for diagnostics. */
  private firstImportError: unknown;

  constructor(options: FixtureLoaderOptions = {}) {
    this.resolver = options.resolver;
    this.extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    this.importer = options.importer ?? dynamicImport;
    this.fileExists = options.fileExists ?? isFile;
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
   * @throws {SlimError} tagged `NO_CLASS` when nothing matches or the name is
   *   not a usable class name.
   */
  async load(className: string): Promise<FixtureConstructor> {
    if (!isUsableClassName(className)) {
      throw this.noClass(className);
    }

    const custom = this.resolver?.(className);
    if (custom != null) {
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

    throw this.noClass(className);
  }

  private noClass(className: string): SlimError {
    return new SlimError(formatSlimMessage(`${className}`, SLIM_ERROR.NO_CLASS), {
      tag: SLIM_ERROR.NO_CLASS,
      cause: this.firstImportError,
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
      const key = `${candidate.specifier}\u0000${JSON.stringify(candidate.exportPath)}\u0000${candidate.declaredName ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    };

    const file = (path: string, exportPath: readonly string[]): void => {
      push({ specifier: pathToFileURL(path).href, filePath: path, exportPath });
    };

    /** Accept the module when an export declares this fixture name. */
    const declared = (path: string): void => {
      push({
        specifier: pathToFileURL(path).href,
        filePath: path,
        exportPath: [],
        declaredName: className,
      });
    };

    if (!isFileSystemPath(root)) {
      push({ specifier: root, filePath: null, exportPath: segments });
      push({ specifier: root, filePath: null, exportPath: ["default", ...segments] });
      return candidates;
    }

    const base = isAbsolute(root) ? root : resolve(this.cwd, root);

    // (a) The root itself is a module file. The bare default export is only
    // accepted when the file is named after the class, so an unrelated module
    // root cannot satisfy an arbitrary class name.
    file(base, segments);
    file(base, ["default", ...segments]);
    if (isNameDerived(base, className)) {
      file(base, []);
      declared(base);
    }
    for (const extension of this.extensions) {
      file(`${base}${extension}`, segments);
      file(`${base}${extension}`, ["default", ...segments]);
      if (isNameDerived(`${base}${extension}`, className)) {
        file(`${base}${extension}`, []);
        declared(`${base}${extension}`);
      }
    }

    // (b) The root is a directory; the class name maps to a file.
    for (const extension of this.extensions) {
      const nested = `${join(base, ...segments)}${extension}`;
      file(nested, []);
      file(nested, segments);
      file(nested, ["default", ...segments]);
      declared(nested);

      if (segments.length > 1) {
        const flattened = `${join(base, segments.join("."))}${extension}`;
        file(flattened, []);
        file(flattened, segments);
        file(flattened, ["default", ...segments]);
        declared(flattened);
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

    if (candidate.declaredName !== undefined) {
      return findDeclaredExport(namespace, candidate.declaredName);
    }

    const value = resolveExport(namespace, candidate.exportPath);
    return typeof value === "function" ? (value as FixtureConstructor) : undefined;
  }

  private importModule(specifier: string): Promise<unknown | null> {
    let cached = this.moduleCache.get(specifier);
    if (cached === undefined) {
      cached = this.importer(specifier).catch((error: unknown) => {
        this.firstImportError ??= error;
        // Do not cache failures: a fixture may become importable later.
        this.moduleCache.delete(specifier);
        return null;
      });
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
  // Mirror Java's char-based swap: never change the string's length.
  return swapped.length === 1 ? `${swapped}${value.slice(1)}` : value;
}

/**
 * Find an export whose declared fixture name matches (see `FixtureMeta.name`).
 */
function findDeclaredExport(namespace: unknown, name: string): FixtureConstructor | undefined {
  if (namespace === null || typeof namespace !== "object") {
    return undefined;
  }

  for (const value of Object.values(namespace as Record<string, unknown>)) {
    if (typeof value === "function" && declaredFixtureName(value) === name) {
      return value as FixtureConstructor;
    }
  }
  return undefined;
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
    if (!Object.hasOwn(Object(current), key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** True when a module file is named after the class (case-insensitively). */
function isNameDerived(filePath: string, className: string): boolean {
  const stem = basename(filePath).replace(/\.[^.]+$/, "");
  return stem.toLowerCase() === className.toLowerCase();
}

/** Reject names that could escape the import root or are not strings. */
function isUsableClassName(className: unknown): className is string {
  return (
    typeof className === "string" &&
    className.length > 0 &&
    !/[\\/]/.test(className) &&
    !className.includes("..")
  );
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
