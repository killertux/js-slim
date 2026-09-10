import { coerceArgument } from "../converters/coerce.js";
import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";
import { isFactoryFixture, type FixtureClass, type FixtureFactory } from "../fixture.js";
import type { SlimValue } from "../protocol/types.js";
import { FixtureLoader } from "./fixture-loader.js";
import { VariableStore } from "./variable-store.js";

/** A fixture registered as a library (instance name starting with `library`). */
export interface Library {
  readonly instanceName: string;
  readonly instance: unknown;
}

export interface ExecutionContextOptions {
  /** Loader used by {@link ExecutionContext.create}. */
  fixtureLoader?: FixtureLoader;
}

/**
 * Per-session fixture state: created instances, libraries, symbols and import
 * paths. Port of `fitnesse.slim.SlimExecutionContext`.
 */
export class ExecutionContext {
  private readonly instances = new Map<string, unknown>();
  private readonly libraryList: Library[] = [];
  private readonly variableStore = new VariableStore();
  private readonly loader: FixtureLoader;

  constructor(options: ExecutionContextOptions = {}) {
    this.loader = options.fixtureLoader ?? new FixtureLoader();
  }

  /** The session's symbol table. */
  get variables(): VariableStore {
    return this.variableStore;
  }

  /** Registered libraries, in insertion order. */
  get libraries(): readonly Library[] {
    return [...this.libraryList];
  }

  /** Fixture import paths, most-recent first. */
  get paths(): readonly string[] {
    return this.loader.paths;
  }

  /** Add a fixture import path (later additions take precedence). */
  addPath(path: string): void {
    this.loader.addPath(path);
  }

  /** Register a library instance explicitly. */
  addLibrary(instanceName: string, instance: unknown): void {
    this.libraryList.push({ instanceName, instance });
  }

  /** Store a named instance. */
  setInstance(instanceName: string, instance: unknown): void {
    this.instances.set(instanceName, instance);
  }

  /**
   * Look up an instance by name, falling back to registered libraries.
   *
   * @throws {SlimError} tagged `NO_INSTANCE` when unknown.
   */
  getInstance(instanceName: string): unknown {
    const instance = this.instances.get(instanceName);
    if (instance !== undefined && instance !== null) {
      return instance;
    }

    for (const library of this.libraryList) {
      if (library.instanceName === instanceName) {
        return library.instance;
      }
    }

    throw new SlimError(formatSlimMessage(instanceName, SLIM_ERROR.NO_INSTANCE), {
      tag: SLIM_ERROR.NO_INSTANCE,
    });
  }

  /** Look up an instance, or `undefined` when it does not exist. */
  tryGetInstance(instanceName: string): unknown {
    try {
      return this.getInstance(instanceName);
    } catch {
      return undefined;
    }
  }

  /**
   * Create a fixture and register it.
   *
   * A class name that is a whole `$symbol` holding a non-string value is
   * registered directly (symbol copy), otherwise the class is loaded and
   * constructed with symbol-substituted, smart-coerced arguments.
   */
  async create(
    instanceName: string,
    className: string,
    args: readonly SlimValue[] = [],
  ): Promise<unknown> {
    const symbolCopy = this.variableStore.getStored(className);
    if (symbolCopy !== null && typeof symbolCopy !== "string") {
      this.addToInstancesOrLibrary(instanceName, symbolCopy);
      return symbolCopy;
    }

    const replacedClassName = this.variableStore.replaceSymbolsInString(className);
    const fixture = await this.loader.load(replacedClassName);
    const constructorArgs = this.variableStore
      .replaceSymbols(args)
      .map((value) => coerceArgument(value));

    // A `factory: true` export builds its instance when called, so closures can
    // produce fixtures; everything else is constructed.
    const instance = isFactoryFixture(fixture)
      ? await (fixture as FixtureFactory)(...(constructorArgs as never[]))
      : new (fixture as FixtureClass)(...(constructorArgs as never[]));

    this.addToInstancesOrLibrary(instanceName, instance);
    return instance;
  }

  /** Replace symbols in an argument list, walking nested lists. */
  replaceSymbols(args: readonly SlimValue[]): unknown[] {
    return this.variableStore.replaceSymbols(args);
  }

  private addToInstancesOrLibrary(instanceName: string, instance: unknown): void {
    if (instanceName.startsWith("library")) {
      this.addLibrary(instanceName, instance);
    } else {
      this.setInstance(instanceName, instance);
    }
  }
}
