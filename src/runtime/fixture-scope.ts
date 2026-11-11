import { AsyncLocalStorage } from "node:async_hooks";

import type { FixtureLoader } from "./fixture-loader.js";

/** What a fixture can reach while one of its instructions runs. */
interface FixtureScope {
  readonly fixtureLoader: FixtureLoader;
}

/**
 * Key of the shared scope storage.
 *
 * `Symbol.for` (not a module-local value) so that a fixture which imports the
 * CJS build sees the scope set by a server running the ESM build, or any other
 * copy of the library.
 */
const SCOPE_KEY = Symbol.for("@killertux/js-slim/fixture-scope");

function scopeStorage(): AsyncLocalStorage<FixtureScope> {
  const holder = globalThis as { [SCOPE_KEY]?: AsyncLocalStorage<FixtureScope> };
  holder[SCOPE_KEY] ??= new AsyncLocalStorage<FixtureScope>();
  return holder[SCOPE_KEY];
}

/** Run `operation` with `scope` visible to {@link currentFixtureLoader}. */
export function runInFixtureScope<T>(scope: FixtureScope, operation: () => T): T {
  return scopeStorage().run(scope, operation);
}

/**
 * The fixture loader of the session whose instruction is running, or
 * `undefined` outside an instruction.
 *
 * Lets a fixture — typically a per-file hook such as Temoc's `file_hooks`
 * fixture — change the session's import paths:
 *
 * ```ts
 * export class SpecHooks {
 *   beginFile(): void {
 *     currentFixtureLoader()?.resetPaths();
 *   }
 * }
 * ```
 *
 * It is set while the session runs an instruction — a fixture's constructor or
 * method, including anything they await — and works from either build of the
 * library.
 */
export function currentFixtureLoader(): FixtureLoader | undefined {
  return scopeStorage().getStore()?.fixtureLoader;
}
