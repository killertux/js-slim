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
 * `constructor`, accessors and `Object.prototype` members are never fixture
 * methods. Use {@link MethodResolver.resolve} to prefer exact-arity matches
 * across a receiver chain.
 */
export function findMethodOn(
  target: object,
  methodName: string,
  arity: number,
): { name: string; method: FixtureMethod } | undefined {
  return findMethod(target, methodName, (method) => method.length <= arity);
}

/**
 * List the methods visible on an object (own and inherited), sorted by name.
 *
 * Used to build `NO_METHOD_IN_CLASS` diagnostics. Own definitions win over
 * inherited ones, `constructor` and `Object.prototype` members are excluded,
 * and only data (non-accessor) function properties are listed.
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
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
    const value = readProperty(target, name);
    if (isObjectLike(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolves fixture method calls.
 *
 * The receiver chain is the fixture, then its System Under Test, then any
 * libraries (in the order supplied — most recent first, like the Java executor
 * chain). Within the chain an exact-arity match wins anywhere before a
 * relaxed (`fn.length < arity`) match is considered, so a lower-arity fixture
 * method cannot shadow a correctly-arity method on the SUT or a library.
 */
export class MethodResolver {
  private readonly sutNames: readonly string[];

  constructor(options: MethodResolverOptions = {}) {
    this.sutNames = options.sutNames ?? DEFAULT_SUT_NAMES;
  }

  /**
   * Resolve `methodName` across the receiver chain.
   *
   * @param libraries objects searched after the fixture and its SUT.
   * @returns the match, or `undefined` when no object has a suitable method.
   */
  resolve(
    target: object,
    methodName: string,
    arity: number,
    libraries: readonly object[] = [],
  ): MethodMatch | undefined {
    const chain = this.receiverChain(target, libraries);

    for (const receiver of chain) {
      const exact = findMethod(receiver, methodName, (method) => method.length === arity);
      if (exact !== undefined) {
        return { receiver, ...exact };
      }
    }

    for (const receiver of chain) {
      const relaxed = findMethod(receiver, methodName, (method) => method.length < arity);
      if (relaxed !== undefined) {
        return { receiver, ...relaxed };
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

  private receiverChain(target: object, libraries: readonly object[]): object[] {
    const sut = this.findSut(target);
    return sut === undefined ? [target, ...libraries] : [target, sut as object, ...libraries];
  }
}

/** Look up a fixture method by name candidate, keeping only data properties. */
function findMethod(
  target: object,
  methodName: string,
  accepts: (method: FixtureMethod) => boolean,
): { name: string; method: FixtureMethod } | undefined {
  for (const name of [methodName, swapCaseOfFirstLetter(methodName)]) {
    if (name === "constructor") {
      continue;
    }
    const method = lookupFunction(target, name);
    if (method !== undefined && accepts(method)) {
      return { name, method };
    }
  }
  return undefined;
}

/**
 * Read a function-valued data property, walking the prototype chain but
 * stopping before `Object.prototype`. Accessors are ignored so a getter is
 * never invoked during method lookup.
 */
function lookupFunction(target: object, name: string): FixtureMethod | undefined {
  let current: object | null = target;

  while (current !== null && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor !== undefined) {
      return typeof descriptor.value === "function"
        ? (descriptor.value as FixtureMethod)
        : undefined;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

/**
 * Read a property, walking the prototype chain but stopping before
 * `Object.prototype`. Getter errors are swallowed so SUT detection cannot throw.
 */
function readProperty(target: object, name: string): unknown {
  let current: object | null = target;

  while (current !== null && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor !== undefined) {
      if ("value" in descriptor) {
        return descriptor.value;
      }
      if (descriptor.get !== undefined) {
        try {
          return descriptor.get.call(target);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function constructorName(target: object): string {
  try {
    const constructor = (target as { constructor?: unknown }).constructor;
    if (typeof constructor === "function" && constructor.name.length > 0) {
      return constructor.name;
    }
  } catch {
    // Fall through to the generic name.
  }
  return "Object";
}

function isObjectLike(value: unknown): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
