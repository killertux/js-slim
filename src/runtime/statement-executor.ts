import { coerceArgument, toSlimValue } from "../converters/coerce.js";
import {
  SLIM_ERROR,
  SlimError,
  formatException,
  formatSlimMessage,
  isStopOrIgnoreError,
} from "../errors.js";
import type { SlimInstruction } from "../instructions/types.js";
import type { SlimSerializable, SlimValue } from "../protocol/types.js";
import { ExecutionContext } from "./execution-context.js";
import { SLIM_HELPER_LIBRARY_NAME, SlimHelperLibrary, type ActorHost } from "./helper-library.js";
import { MethodResolver, invokeMethod } from "./method-resolver.js";

/** A `[id, value]` response row. */
export type SlimRow = SlimSerializable[];

export interface StatementExecutorOptions {
  /** Session state. Defaults to a fresh {@link ExecutionContext}. */
  context?: ExecutionContext;
  /** Method resolver to use. */
  methodResolver?: MethodResolver;
  /** Register the built-in `SlimHelperLibrary`. Defaults to true. */
  helperLibrary?: boolean;
  /** Per-instruction timeout in seconds. Disabled when unset or <= 0. */
  timeoutSeconds?: number | undefined;
}

/**
 * Executes parsed SLiM instructions against fixtures.
 *
 * Port of `fitnesse.slim.StatementExecutor` (plus the `ListExecutor` batch
 * loop): it owns the fixture/SUT/library resolution order, argument symbol
 * substitution and conversion, and the stop/ignore flag.
 */
export class StatementExecutor implements ActorHost {
  private readonly executionContext: ExecutionContext;
  private readonly resolver: MethodResolver;
  private readonly timeoutSeconds: number;
  private stopRequested = false;

  constructor(options: StatementExecutorOptions = {}) {
    this.executionContext = options.context ?? new ExecutionContext();
    this.resolver = options.methodResolver ?? new MethodResolver();
    this.timeoutSeconds = options.timeoutSeconds ?? 0;

    if (options.helperLibrary !== false) {
      this.installHelperLibrary();
    }
  }

  /** The session's execution context. */
  get context(): ExecutionContext {
    return this.executionContext;
  }

  /** Add a fixture import path. */
  addPath(path: string): void {
    this.executionContext.addPath(path);
  }

  /** Store a symbol value directly. */
  assign(name: string, value: unknown): void {
    this.executionContext.variables.set(name, value);
  }

  /** @returns the text form of a stored symbol, or `null` when undefined. */
  getSymbol(name: string): unknown {
    return this.executionContext.variables.get(name)?.text ?? null;
  }

  /** @returns the raw value of a stored symbol, or `null` when undefined. */
  getSymbolObject(name: string): unknown {
    return this.executionContext.variables.get(name)?.value ?? null;
  }

  /** Look up an instance by name. */
  getInstance(instanceName: string): unknown {
    return this.executionContext.getInstance(instanceName);
  }

  /** Store a named instance (used by the helper library). */
  setInstance(instanceName: string, instance: unknown): void {
    this.executionContext.setInstance(instanceName, instance);
  }

  /**
   * Create a fixture.
   *
   * @throws {SlimError} tagged `COULD_NOT_INVOKE_CONSTRUCTOR` when construction
   *   fails (including an unknown class).
   */
  async create(
    instanceName: string,
    className: string,
    args: readonly SlimValue[] = [],
  ): Promise<unknown> {
    try {
      return await this.executionContext.create(instanceName, className, args);
    } catch (error) {
      this.checkForStop(error);

      // A constructor (or the fixture it calls) may abort the test itself; keep
      // the marker intact rather than reporting it as a construction failure.
      if (isStopOrIgnoreError(error)) {
        throw error;
      }

      // Only a class that could not be loaded is reported as a construction
      // failure; anything thrown by the constructor body passes through.
      if (error instanceof SlimError && error.tag === SLIM_ERROR.NO_CLASS) {
        throw new SlimError(
          formatSlimMessage(
            `${className}[${args.length}]`,
            SLIM_ERROR.COULD_NOT_INVOKE_CONSTRUCTOR,
          ),
          { tag: SLIM_ERROR.COULD_NOT_INVOKE_CONSTRUCTOR, cause: error },
        );
      }

      throw error;
    }
  }

  /**
   * Invoke a method on an instance, its System Under Test, or a library.
   *
   * @throws {SlimError} tagged `NO_INSTANCE` (unknown instance and no library
   *   match) or `NO_METHOD_IN_CLASS` (no matching method).
   */
  async call(
    instanceName: string,
    methodName: string,
    args: readonly SlimValue[] = [],
  ): Promise<unknown> {
    const replaced = this.executionContext.replaceSymbols(args);
    const converted = replaced.map((value) => coerceArgument(value));
    const targets = this.receiverTargets(instanceName);

    const match = this.resolver.resolveInTargets(targets, methodName, replaced.length);
    if (match === undefined) {
      throw this.missingMethodError(instanceName, methodName, replaced.length);
    }

    return await invokeMethod(match, converted);
  }

  /** Invoke a method and store its result as a symbol. */
  async callAndAssign(
    symbolName: string,
    instanceName: string,
    methodName: string,
    args: readonly SlimValue[] = [],
  ): Promise<unknown> {
    const value = await this.call(instanceName, methodName, args);
    this.executionContext.variables.set(symbolName, value);
    return value;
  }

  /** @returns true when a stop/ignore error was seen in the current batch. */
  stopHasBeenRequested(): boolean {
    return this.stopRequested;
  }

  /** Clear the stop request flag (called after a batch). */
  reset(): void {
    this.stopRequested = false;
  }

  /** Execute a single parsed instruction, returning its `[id, value]` row. */
  async execute(instruction: SlimInstruction): Promise<SlimRow> {
    return await this.withTimeout(async () => {
      switch (instruction.kind) {
        case "import":
          this.addPath(instruction.path);
          return [instruction.id, "OK"];

        case "make":
          await this.create(instruction.instanceName, instruction.className, instruction.args);
          return [instruction.id, "OK"];

        case "assign":
          this.assign(instruction.symbolName, instruction.value);
          return [instruction.id, "OK"];

        case "call": {
          const value = await this.call(
            instruction.instanceName,
            instruction.methodName,
            instruction.args,
          );
          return [instruction.id, toSlimValue(value)];
        }

        case "callAndAssign": {
          const value = await this.callAndAssign(
            instruction.symbolName,
            instruction.instanceName,
            instruction.methodName,
            instruction.args,
          );
          return [instruction.id, toSlimValue(value)];
        }

        case "invalid":
          throw new SlimError(
            formatSlimMessage(instruction.operation, SLIM_ERROR.MALFORMED_INSTRUCTION),
            { tag: SLIM_ERROR.MALFORMED_INSTRUCTION },
          );
      }
    });
  }

  /**
   * Execute one instruction, converting a failure into an exception row and
   * recording a stop/ignore request. Used by the session loop.
   */
  async runInstruction(instruction: SlimInstruction): Promise<SlimRow> {
    try {
      return await this.execute(instruction);
    } catch (error) {
      this.checkForStop(error);
      return [instruction.id, formatException(error)];
    }
  }

  /**
   * Execute a batch of instructions.
   *
   * Errors become `[id, "__EXCEPTION__:…"]` rows; a stop/ignore error skips the
   * remaining instructions and clears the flag afterwards (Java parity).
   */
  async executeAll(instructions: readonly SlimInstruction[]): Promise<SlimRow[]> {
    const results: SlimRow[] = [];

    for (const instruction of instructions) {
      if (this.stopRequested) {
        break;
      }
      results.push(await this.runInstruction(instruction));
    }

    if (this.stopRequested) {
      this.reset();
    }
    return results;
  }

  /** Receiver chain: fixture, its SUT, then libraries most-recent-first. */
  private receiverTargets(instanceName: string): object[] {
    const targets: object[] = [];
    const fixture = this.executionContext.tryGetInstance(instanceName);

    if (fixture !== undefined && fixture !== null) {
      targets.push(fixture as object);
      const sut = this.resolver.findSut(fixture as object);
      if (sut !== undefined) {
        targets.push(sut as object);
      }
    }

    const libraries = this.executionContext.libraries;
    for (let index = libraries.length - 1; index >= 0; index -= 1) {
      targets.push(libraries[index]!.instance as object);
    }

    return targets;
  }

  private missingMethodError(instanceName: string, methodName: string, arity: number): SlimError {
    const fixture = this.executionContext.tryGetInstance(instanceName);
    if (fixture === undefined || fixture === null) {
      return new SlimError(
        formatSlimMessage(`${instanceName}.${methodName}.`, SLIM_ERROR.NO_INSTANCE),
        { tag: SLIM_ERROR.NO_INSTANCE },
      );
    }
    return this.resolver.noMethodError(fixture as object, methodName, arity);
  }

  private checkForStop(error: unknown): void {
    if (isStopOrIgnoreError(error)) {
      this.stopRequested = true;
    }
  }

  /**
   * Race an instruction against the configured timeout.
   *
   * Unlike Java, an operation that exceeds the timeout keeps running in the
   * background (JavaScript has no cancellation), so it may still mutate session
   * state after its `TIMED_OUT` response has been written.
   */
  private async withTimeout<T>(operation: () => Promise<T>): Promise<T> {
    if (this.timeoutSeconds <= 0) {
      return await operation();
    }

    const seconds = this.timeoutSeconds;
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new SlimError(formatSlimMessage(String(seconds), SLIM_ERROR.TIMED_OUT), {
                tag: SLIM_ERROR.TIMED_OUT,
              }),
            );
          }, seconds * 1000);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private installHelperLibrary(): void {
    const helper = new SlimHelperLibrary();
    helper.setStatementExecutor(this);
    this.executionContext.addLibrary(SLIM_HELPER_LIBRARY_NAME, helper);
  }
}
