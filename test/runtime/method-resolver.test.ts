import { describe, expect, it } from "vitest";

import { SLIM_ERROR, SlimError } from "../../src/errors.js";
import {
  MethodResolver,
  describeMethods,
  findMethodOn,
  findSystemUnderTest,
  invokeMethod,
  listMethods,
  type FixtureMethod,
} from "../../src/runtime/method-resolver.js";

class BaseFixture {
  inherited(): string {
    return "base";
  }

  shared(): string {
    return "base-shared";
  }
}

class TestFixture extends BaseFixture {
  value = 0;
  sut?: object;
  systemUnderTest?: object;

  addTo(a: number, b: number): number {
    return a + b;
  }

  returnString(): string {
    return "string";
  }

  echoString(value: string): string {
    return value;
  }

  collect(...args: unknown[]): number {
    return args.length;
  }

  override shared(): string {
    return "fixture-shared";
  }

  setValue(value: number): void {
    this.value = value;
  }

  getValue(): number {
    return this.value;
  }

  asyncValue(): Promise<string> {
    return Promise.resolve("async");
  }
}

function makeFixture(): TestFixture {
  return new TestFixture();
}

describe("findMethodOn", () => {
  it("matches by exact name", () => {
    expect(findMethodOn(makeFixture(), "addTo", 2)?.name).toBe("addTo");
  });

  it("falls back to swapping the first letter's case", () => {
    expect(findMethodOn(makeFixture(), "AddTo", 2)?.name).toBe("addTo");
  });

  it("rejects a call that is missing required parameters", () => {
    expect(findMethodOn(makeFixture(), "addTo", 1)).toBeUndefined();
  });

  it("accepts extra arguments (JavaScript ignores them)", () => {
    expect(findMethodOn(makeFixture(), "addTo", 3)?.name).toBe("addTo");
  });

  it("matches rest-parameter methods at any arity", () => {
    expect(findMethodOn(makeFixture(), "collect", 5)?.name).toBe("collect");
  });

  it("finds inherited methods", () => {
    expect(findMethodOn(makeFixture(), "inherited", 0)?.name).toBe("inherited");
  });

  it("never resolves constructor", () => {
    expect(findMethodOn(makeFixture(), "constructor", 0)).toBeUndefined();
  });

  it("accepts methods defined as instance properties", () => {
    expect(findMethodOn({ greet: () => "hi" }, "greet", 0)?.name).toBe("greet");
  });

  it("returns undefined for unknown methods", () => {
    expect(findMethodOn(makeFixture(), "noSuchMethod", 0)).toBeUndefined();
  });
});

describe("listMethods / describeMethods", () => {
  it("lists own and inherited methods, sorted, without constructor", () => {
    const names = listMethods(makeFixture()).map((method) => method.name);

    expect(names).toContain("addTo");
    expect(names).toContain("inherited");
    expect(names).not.toContain("constructor");
    expect(names).toEqual([...names].sort());
  });

  it("describes methods as name(arity) lines", () => {
    const description = describeMethods(makeFixture());
    expect(description).toContain("addTo(2)");
    expect(description).toContain("returnString(0)");
  });
});

describe("invokeMethod", () => {
  it("invokes the method with the correct receiver", async () => {
    const fixture = makeFixture();
    const found = findMethodOn(fixture, "setValue", 1);
    expect(found).toBeDefined();

    await invokeMethod({ receiver: fixture, name: "setValue", method: found!.method }, [7]);
    expect(fixture.getValue()).toBe(7);
  });

  it("awaits promise-returning methods", async () => {
    const fixture = makeFixture();
    const match = new MethodResolver().resolve(fixture, "asyncValue", 0);
    expect(match).toBeDefined();

    await expect(invokeMethod(match!, [])).resolves.toBe("async");
  });
});

describe("MethodResolver", () => {
  it("resolves a method on the fixture itself", () => {
    const fixture = makeFixture();
    const match = new MethodResolver().resolve(fixture, "addTo", 2);
    expect(match?.receiver).toBe(fixture);
    expect(match?.name).toBe("addTo");
  });

  it("falls back to the System Under Test", () => {
    const sut = { sutMethod: () => "sut" };
    const fixture = makeFixture();
    fixture.sut = sut;

    const match = new MethodResolver().resolve(fixture, "sutMethod", 0);
    expect(match?.receiver).toBe(sut);
    expect(match?.name).toBe("sutMethod");
  });

  it("prefers a fixture method over the System Under Test", () => {
    const sut = { shared: () => "sut-shared" };
    const fixture = makeFixture();
    fixture.sut = sut;

    expect(new MethodResolver().resolve(fixture, "shared", 0)?.receiver).toBe(fixture);
  });

  it("supports the systemUnderTest property", () => {
    const sut = { sutMethod: () => "sut" };
    const fixture = makeFixture();
    fixture.systemUnderTest = sut;

    expect(new MethodResolver().resolve(fixture, "sutMethod", 0)?.receiver).toBe(sut);
  });

  it("supports custom System Under Test property names", () => {
    const sut = { doIt: () => 1 };
    const fixture = { target: sut };
    const resolver = new MethodResolver({ sutNames: ["target"] });

    expect(resolver.resolve(fixture, "doIt", 0)?.receiver).toBe(sut);
  });

  it("ignores non-object System Under Test values", () => {
    const fixture = makeFixture();
    fixture.sut = "not an object" as unknown as object;

    expect(new MethodResolver().findSut(fixture)).toBeUndefined();
    expect(findSystemUnderTest(fixture)).toBeUndefined();
  });

  it("returns undefined when neither the fixture nor the SUT has the method", () => {
    const fixture = makeFixture();
    fixture.sut = { sutMethod: () => "sut" };

    expect(new MethodResolver().resolve(fixture, "missing", 0)).toBeUndefined();
  });

  it("builds a NO_METHOD_IN_CLASS error", () => {
    const error = new MethodResolver().noMethodError(makeFixture(), "missing", 3);

    expect(error).toBeInstanceOf(SlimError);
    expect(error.tag).toBe(SLIM_ERROR.NO_METHOD_IN_CLASS);
    expect(error.message).toContain(
      "message:<<NO_METHOD_IN_CLASS No Method missing[3] in class TestFixture.",
    );
    expect(error.message).toContain("addTo(2)");
  });
});

describe("MethodResolver arity and receiver chain", () => {
  class ShadowFixture {
    sut?: object;
    doThing(): string {
      return "fixture";
    }
  }

  it("prefers an exact-arity SUT method over a relaxed fixture method", () => {
    const sut = { doThing: (a: number, b: number): string => `sut:${a + b}` };
    const fixture = new ShadowFixture();
    fixture.sut = sut;

    const match = new MethodResolver().resolve(fixture, "doThing", 2);
    expect(match?.receiver).toBe(sut);
    expect(match?.name).toBe("doThing");
  });

  it("falls back to a relaxed fixture method when nothing has the exact arity", () => {
    const fixture = makeFixture();
    expect(new MethodResolver().resolve(fixture, "addTo", 3)?.receiver).toBe(fixture);
  });

  it("searches libraries after the fixture and its SUT, in order", () => {
    const lib1 = { fromLib: () => "lib1" };
    const lib2 = { fromLib: () => "lib2" };

    const match = new MethodResolver().resolve(makeFixture(), "fromLib", 0, [lib1, lib2]);
    expect(match?.receiver).toBe(lib1);
  });

  it("prefers an exact-arity library method over a relaxed fixture method", () => {
    class RelaxedFixture {
      run(): string {
        return "fixture";
      }
    }

    const library = { run: (a: number): string => `lib:${a}` };
    const match = new MethodResolver().resolve(new RelaxedFixture(), "run", 1, [library]);
    expect(match?.receiver).toBe(library);
  });
});

describe("MethodResolver robustness", () => {
  it("does not resolve Object.prototype members", () => {
    expect(findMethodOn(makeFixture(), "hasOwnProperty", 1)).toBeUndefined();
    expect(findMethodOn(makeFixture(), "toString", 0)).toBeUndefined();
    expect(listMethods(makeFixture()).map((method) => method.name)).not.toContain("toString");
  });

  it("lists instance property functions", () => {
    expect(listMethods({ greet: () => "hi" }).map((method) => method.name)).toContain("greet");
  });

  it("never invokes getters during method lookup", () => {
    class GetterFixture {
      get boom(): FixtureMethod {
        throw new Error("getter must not run");
      }
    }

    expect(findMethodOn(new GetterFixture(), "boom", 0)).toBeUndefined();
  });

  it("ignores a System Under Test getter that throws", () => {
    class ThrowingSutFixture {
      get sut(): object {
        throw new Error("boom");
      }
    }

    expect(new MethodResolver().findSut(new ThrowingSutFixture() as object)).toBeUndefined();
  });

  it("propagates synchronous throws and rejected promises", async () => {
    const sync = {
      receiver: {},
      name: "boom",
      method: (): never => {
        throw new Error("sync");
      },
    };
    await expect(invokeMethod(sync, [])).rejects.toThrow("sync");

    const rejected = {
      receiver: {},
      name: "boom",
      method: (): Promise<never> => Promise.reject(new Error("async")),
    };
    await expect(invokeMethod(rejected, [])).rejects.toThrow("async");
  });

  it("names the fallback class in a NO_METHOD_IN_CLASS error for a bare object", () => {
    const error = new MethodResolver().noMethodError(Object.create(null) as object, "x", 0);
    expect(error.message).toContain("in class Object.");
  });
});
