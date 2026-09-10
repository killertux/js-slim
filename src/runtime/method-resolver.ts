import { SLIM_ERROR, SlimError, formatSlimMessage } from "../errors.js";
import { swapCaseOfFirstLetter } from "./fixture-loader.js";

/** A callable fixture method. */
export type FixtureMethod = (...args: unknown[]) => unknown;

/** A method exposed by a fixture. */
export interface MethodInfo {
  readonly name: string;
  readonly arity: number;
}

/** A resolved method plus the object it must be invoked on. */
export interface MethodMatch {
  readonly receiver: object;
  /** The resolved method name (may differ in case from the request). */
  readonly name: string;
  readonly method: FixtureMethod;
}

export interface MethodResolverOptions {
  /** Property names that may hold the System Under Test. */
  sutNames?: readonly string[];
}

/** Default property names searched for the System Under Test. */
export const DEFAULT_SUT_NAMES = ["sut", "systemUnderTest"] as const;

/**
 * Find a method on a single object by name and argument count.
 *
 * The exact name is tried first, then the `swapCaseOfFirstLetter` variant
 * (Java parity). A method matches when it declares at most `arity` parameters
 * (`fn.length <= arity`) — JavaScript ignores extra arguments, so a
 * `fn.length > arity` mismatch means the call is missing required parameters.
 * `constructor` is never a fixture method.
 */
export function findMethodOn(
  target: object,
  methodName: string,
  arity: number,
): { name: string; method: FixtureMethod } | undefined {
  const record = target as Record<string, unknown>;

  for (const name of [methodName, swapCaseOfFirstLetter(methodName)]) {
    if (name === "constructor") {
      continue;
    }
    const value = record[name];
    if (typeof value === "function" && (value as FixtureMethod).length <= arity) {
      return { name, method: value as FixtureMethod };
    }
  }
  return undefined;
}

/**
 * List the methods visible on an object (own and inherited), sorted by name.
 *
 * Used to build `NO_METHOD_IN_CLASS` diagnostics. Own definitions win over
 * inherited ones and `constructor` is excluded.
 */
export function listMethods(target: object): MethodInfo[] {
  const found = new Map<string, number>();
  let current: object | null = target;

  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === "constructor" || found.has(name)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (descriptor !== undefined && typeof descriptor.value === "function") {
        found.set(name, (descriptor.value as FixtureMethod).length);
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }

  return [...found.entries()]
    .map(([name, arity]) => ({ name, arity }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Render the available methods as `name(arity)` lines, sorted by name. */
export function describeMethods(target: object): string {
  return listMethods(target)
    .map((method) => `${method.name}(${method.arity})`)
    .join("\n");
}

/** Invoke a resolved method, awaiting promise-returning fixtures. */
export async function invokeMethod(match: MethodMatch, args: readonly unknown[]): Promise<unknown> {
  return await match.method.call(match.receiver, ...args);
}

/** Find the System Under Test of an object via its `sut`/`systemUnderTest` property. */
export function findSystemUnderTest(
  target: object,
  names: readonly string[] = DEFAULT_SUT_NAMES,
): unknown {
  for (const name of names) {
    if (name in target) {
      const value = (target as Record<string, unknown>)[name];
      if (isObjectLike(value)) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Resolves fixture method calls.
 *
 * A method is looked up on the fixture first, then on its System Under Test.
 * Libraries and the full executor chain are wired by the statement executor
 * (step 9).
 */
export class MethodResolver {
  private readonly sutNames: readonly string[];

  constructor(options: MethodResolverOptions = {}) {
    this.sutNames = options.sutNames ?? DEFAULT_SUT_NAMES;
  }

  /**
   * Resolve `methodName` on `target`, then on its System Under Test.
   *
   * @returns the match, or `undefined` when neither object has a suitable method.
   */
  resolve(target: object, methodName: string, arity: number): MethodMatch | undefined {
    const direct = findMethodOn(target, methodName, arity);
    if (direct !== undefined) {
      return { receiver: target, ...direct };
    }

    const sut = this.findSut(target);
    if (sut !== undefined) {
      const onSut = findMethodOn(sut as object, methodName, arity);
      if (onSut !== undefined) {
        return { receiver: sut as object, ...onSut };
      }
    }
    return undefined;
  }

  /** Find the System Under Test of a fixture, if any. */
  findSut(target: object): unknown {
    return findSystemUnderTest(target, this.sutNames);
  }

  /** Methods visible on a fixture, sorted by name. */
  listMethods(target: object): MethodInfo[] {
    return listMethods(target);
  }

  /** `name(arity)` lines for diagnostics. */
  describeMethods(target: object): string {
    return describeMethods(target);
  }

  /** Build the Java-shaped `NO_METHOD_IN_CLASS` error for a failed call. */
  noMethodError(target: object, methodName: string, arity: number): SlimError {
    const className = constructorName(target);
    const message =
      `No Method ${methodName}[${arity}] in class ${className}.\n` +
      ` Available methods:\n${this.describeMethods(target)}`;

    return new SlimError(formatSlimMessage(message, SLIM_ERROR.NO_METHOD_IN_CLASS), {
      tag: SLIM_ERROR.NO_METHOD_IN_CLASS,
    });
  }
}

function constructorName(target: object): string {
  const constructor = (target as { constructor?: unknown }).constructor;
  if (typeof constructor === "function" && constructor.name.length > 0) {
    return constructor.name;
  }
  return "Object";
}

function isObjectLike(value: unknown): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
