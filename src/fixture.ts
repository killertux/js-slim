/**
 * The typed authoring API.
 *
 * Fixtures declare their FitNesse-facing name, their System Under Test and the
 * SLiM type of every parameter and return value so the runtime converts values
 * exactly instead of guessing. Metadata is attached to the class (or factory
 * function) under a `Symbol.for`-keyed property, so the ESM and CJS builds — or
 * any duplicated copy of the library — read the same metadata.
 *
 * ```ts
 * @slimFixture({ sut: "calculator" })
 * class Life {
 *   calculator = new Calculator();
 *
 *   @slimMethod({ name: "sum of", params: [listOf(Number)], returns: Number })
 *   sum(values: number[]): number {
 *     return values.reduce((total, value) => total + value, 0);
 *   }
 * }
 * ```
 *
 * JavaScript authors use {@link fixture} / {@link defineFixture} instead of
 * decorators.
 */

import type { SlimType } from "./converters/slim-type.js";

export { listOf } from "./converters/slim-type.js";
export type { ListSlimType, SlimType } from "./converters/slim-type.js";

/** A constructable fixture export. */
export type FixtureClass = new (...args: never[]) => unknown;

/**
 * A fixture export that builds its instance when called.
 *
 * Selected with `factory: true` in {@link FixtureMeta}; see
 * {@link defineFixture}.
 */
export type FixtureFactory = (...args: never[]) => unknown;

/** Anything the loader can return: a class or a factory function. */
export type FixtureExport = FixtureClass | FixtureFactory;

/** Metadata for a single fixture method. */
export interface MethodMeta {
  /** Wire name used by FitNesse. Defaults to the JavaScript method name. */
  readonly name?: string;
  /** Declared parameter types, in order. */
  readonly params?: readonly SlimType[];
  /** Declared return type. */
  readonly returns?: SlimType;
}

/** Metadata for a fixture class or factory function. */
export interface FixtureMeta {
  /**
   * Fixture name. Used in diagnostics, and to resolve the fixture when a
   * module file is named after it (see {@link FixtureLoader.load}).
   */
  readonly name?: string;
  /** Per-method metadata keyed by the JavaScript method name. */
  readonly methods?: Record<string, MethodMeta>;
  /** Property holding the System Under Test, overriding `sut`/`systemUnderTest`. */
  readonly sut?: string;
  /**
   * Treat the export as a factory function: call it instead of `new`.
   *
   * The export must be an ordinary function — calling a class without `new`, or
   * constructing an arrow function, fails when the fixture is made.
   */
  readonly factory?: boolean;
}

/**
 * Key of the fixture metadata property.
 *
 * `Symbol.for` (not `Symbol`) so that a fixture decorated through one copy of
 * the library — say the CJS build — is still recognised by another.
 */
export const FIXTURE_META: unique symbol = Symbol.for("@killertux/js-slim/fixture");

/** Key of the method metadata property on a method function. */
export const METHOD_META: unique symbol = Symbol.for("@killertux/js-slim/method");

/** Signature of the {@link slimFixture} decorator (standard, stage-3). */
export type SlimFixtureDecorator = <T extends abstract new (...args: never[]) => unknown>(
  value: T,
  context: ClassDecoratorContext,
) => T;

/** Signature of the {@link slimMethod} decorator (standard, stage-3). */
export type SlimMethodDecorator = (
  value: (...args: never[]) => unknown,
  context: ClassMethodDecoratorContext,
) => void;

/**
 * Class decorator declaring fixture metadata.
 *
 * ```ts
 * @slimFixture({ name: "MyFixture", sut: "service" })
 * class MyFixture {}
 * ```
 */
export function slimFixture(meta: FixtureMeta = {}): SlimFixtureDecorator {
  return (value) => {
    defineFixture(value as unknown as FixtureExport, meta);
    return value;
  };
}

/**
 * Method decorator declaring per-method metadata.
 *
 * ```ts
 * @slimMethod({ name: "sum of", params: [listOf(Number)] })
 * sum(values: number[]): number {}
 * ```
 */
export function slimMethod(meta: MethodMeta): SlimMethodDecorator {
  return (value) => {
    setMeta(value, METHOD_META, { ...getOwnMethodMeta(value), ...meta });
  };
}

/**
 * Attach metadata to a fixture and return it, for JavaScript authors.
 *
 * ```js
 * export const Calculator = fixture({
 *   class: Calc,
 *   methods: { add: { params: [Number, Number], returns: Number } },
 * });
 * ```
 */
export function fixture<C extends FixtureExport>(definition: {
  class: C;
  name?: string;
  methods?: Record<string, MethodMeta>;
  sut?: string;
  factory?: boolean;
}): C {
  const { class: ctor, ...meta } = definition;
  defineFixture(ctor, meta);
  return ctor;
}

/**
 * Attach metadata to an existing fixture.
 *
 * Later calls merge into earlier ones, so a `slimFixture` decorator and a
 * `defineFixture` call can declare different halves of the metadata.
 */
export function defineFixture(ctor: FixtureExport, meta: FixtureMeta): void {
  setMeta(ctor, FIXTURE_META, mergeFixtureMeta(getFixtureMeta(ctor), meta));
}

/**
 * Carry `source`'s metadata onto `target` unless `target` has its own.
 *
 * A `factory: true` export builds its own instance, so metadata declared on the
 * factory function would otherwise be invisible to the runtime: method aliases,
 * declared types and the SUT are all looked up on the *instance*. The execution
 * context calls this right after a factory returns.
 */
export function inheritFixtureMeta(target: object, source: unknown): void {
  if (!Object.isExtensible(target)) {
    return;
  }
  const meta = getFixtureMeta(source);
  if (meta !== undefined && getFixtureMeta(target) === undefined) {
    setMeta(target, FIXTURE_META, meta);
  }
}

/**
 * @returns the fixture metadata attached to `value`, if any.
 *
 * Accepts a class, a factory function, or an *instance* — an instance carries
 * its metadata on its class, which is how the runtime looks up metadata for an
 * already-created fixture.
 */
export function getFixtureMeta(value: unknown): FixtureMeta | undefined {
  const own = readMeta<FixtureMeta>(value, FIXTURE_META);
  if (own !== undefined) {
    return own;
  }
  if (typeof value === "object" && value !== null) {
    return readMeta<FixtureMeta>((value as { constructor?: unknown }).constructor, FIXTURE_META);
  }
  return undefined;
}

/** @returns the metadata attached to a method function by `slimMethod`. */
export function getOwnMethodMeta(method: unknown): MethodMeta | undefined {
  return readMeta<MethodMeta>(method, METHOD_META);
}

/** @returns metadata for a method declared through `FixtureMeta.methods`. */
export function getFixtureMethodMeta(fixture: unknown, methodName: string): MethodMeta | undefined {
  return getFixtureMeta(fixture)?.methods?.[methodName];
}

/**
 * Metadata for a method: the function's own first, then the fixture's
 * `methods` table keyed by the JavaScript method name.
 */
export function getMethodMeta(
  fixture: unknown,
  method: unknown,
  methodName: string,
): MethodMeta | undefined {
  return getOwnMethodMeta(method) ?? getFixtureMethodMeta(fixture, methodName);
}

/** The wire name of a method: its declared alias, or the JavaScript name. */
export function methodWireName(fixture: unknown, methodName: string, method: unknown): string {
  return getMethodMeta(fixture, method, methodName)?.name ?? methodName;
}

/** The fixture's declared name, used to resolve and describe it. */
export function declaredFixtureName(value: unknown): string | undefined {
  return getFixtureMeta(value)?.name;
}

/** The fixture's declared System Under Test property name, if any. */
export function declaredSutName(value: unknown): string | undefined {
  return getFixtureMeta(value)?.sut;
}

/** @returns true when the fixture export must be called rather than `new`ed. */
export function isFactoryFixture(value: unknown): boolean {
  return getFixtureMeta(value)?.factory === true;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function mergeFixtureMeta(base: FixtureMeta | undefined, next: FixtureMeta): FixtureMeta {
  const methods =
    base?.methods === undefined && next.methods === undefined
      ? undefined
      : { ...base?.methods, ...next.methods };

  return {
    ...base,
    ...next,
    ...(methods === undefined ? {} : { methods }),
  };
}

function readMeta<T>(value: unknown, key: symbol): T | undefined {
  if (typeof value !== "function" && (typeof value !== "object" || value === null)) {
    return undefined;
  }
  return (value as Record<symbol, T | undefined>)[key];
}

function setMeta(value: object, key: symbol, meta: object): void {
  Object.defineProperty(value, key, {
    value: meta,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
