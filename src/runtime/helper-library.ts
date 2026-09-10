import { SlimError } from "../errors.js";

/** Instance name the helper library is registered under. */
export const SLIM_HELPER_LIBRARY_NAME = "SlimHelperLibrary";

/** Instance name of the "script table actor" fixture. */
export const SCRIPT_TABLE_ACTOR = "scriptTableActor";

/** The statement-executor surface the helper library needs. */
export interface ActorHost {
  getInstance(instanceName: string): unknown;
  setInstance(instanceName: string, instance: unknown): void;
}

/**
 * Built-in library supporting the actor stack used by script tables.
 *
 * Port of `fitnesse.slim.SlimHelperLibrary`. It is registered as a library, so
 * `pushFixture`/`popFixture`/`getFixture` are reachable from any table whose
 * fixture does not define them.
 */
export class SlimHelperLibrary {
  private host: ActorHost | undefined;
  private readonly stack: unknown[] = [];

  /** Attach the statement executor that owns the actor instances. */
  setStatementExecutor(host: ActorHost): void {
    this.host = host;
  }

  /** @returns the current script-table actor. */
  getFixture(): unknown {
    return this.requireHost().getInstance(SCRIPT_TABLE_ACTOR);
  }

  /** Push the current actor onto the stack. */
  pushFixture(): void {
    this.stack.push(this.getFixture());
  }

  /** Pop an actor from the stack and make it the current script-table actor. */
  popFixture(): void {
    if (this.stack.length === 0) {
      throw new SlimError("Can't popFixture: the fixture stack is empty");
    }
    const actor = this.stack.pop();
    this.requireHost().setInstance(SCRIPT_TABLE_ACTOR, actor);
  }

  /** Identity helper used to copy a symbol in decision tables. */
  cloneSymbol<T>(master: T): T {
    return master;
  }

  private requireHost(): ActorHost {
    if (this.host === undefined) {
      throw new SlimError("SlimHelperLibrary is not attached to a statement executor");
    }
    return this.host;
  }
}
