import { describe, expect, it } from "vitest";

import { SlimError } from "../../src/errors.js";
import { SCRIPT_TABLE_ACTOR, SlimHelperLibrary } from "../../src/runtime/helper-library.js";

function makeHost(): {
  instances: Map<string, unknown>;
  getInstance(name: string): unknown;
  setInstance(name: string, instance: unknown): void;
} {
  const instances = new Map<string, unknown>();
  return {
    instances,
    getInstance: (name: string) => {
      if (!instances.has(name)) {
        throw new SlimError(`no instance ${name}`);
      }
      return instances.get(name);
    },
    setInstance: (name: string, instance: unknown) => {
      instances.set(name, instance);
    },
  };
}

describe("SlimHelperLibrary", () => {
  it("returns the current script table actor", () => {
    const host = makeHost();
    const helper = new SlimHelperLibrary();
    helper.setStatementExecutor(host);

    const actor = {};
    host.setInstance(SCRIPT_TABLE_ACTOR, actor);
    expect(helper.getFixture()).toBe(actor);
  });

  it("pushes and pops the script table actor", () => {
    const host = makeHost();
    const helper = new SlimHelperLibrary();
    helper.setStatementExecutor(host);

    const actorA = {};
    const actorB = {};
    host.setInstance(SCRIPT_TABLE_ACTOR, actorA);
    helper.pushFixture();
    host.setInstance(SCRIPT_TABLE_ACTOR, actorB);
    helper.popFixture();

    expect(host.getInstance(SCRIPT_TABLE_ACTOR)).toBe(actorA);
  });

  it("throws when popping an empty stack", () => {
    const host = makeHost();
    const helper = new SlimHelperLibrary();
    helper.setStatementExecutor(host);
    host.setInstance(SCRIPT_TABLE_ACTOR, {});

    expect(() => helper.popFixture()).toThrow(SlimError);
  });

  it("clones a symbol by identity", () => {
    const value = { a: 1 };
    expect(new SlimHelperLibrary().cloneSymbol(value)).toBe(value);
  });

  it("throws when used before being attached to an executor", () => {
    expect(() => new SlimHelperLibrary().getFixture()).toThrow(SlimError);
  });
});
