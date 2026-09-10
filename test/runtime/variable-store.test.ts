import { describe, expect, it } from "vitest";

import { VariableStore } from "../../src/runtime/variable-store.js";

describe("VariableStore", () => {
  it("stores and looks up symbols", () => {
    const store = new VariableStore();
    store.set("v", "Bob");

    expect(store.has("v")).toBe(true);
    expect(store.get("v")).toEqual({ value: "Bob", text: "Bob" });
    expect(store.has("other")).toBe(false);
  });

  it("renders default text for non-string values", () => {
    const store = new VariableStore();
    store.set("n", 42);
    store.set("list", ["a", "b"]);
    store.set("nil", null);

    expect(store.get("n")?.text).toBe("42");
    expect(store.get("list")?.text).toBe("[a, b]");
    expect(store.get("nil")?.text).toBe("null");
  });

  it("honours an explicit text form", () => {
    const store = new VariableStore();
    store.set("d", new Date(Date.UTC(2009, 4, 5)), "05-May-2009");
    expect(store.get("d")?.text).toBe("05-May-2009");
  });

  it("renders dates, maps, objects and other scalars as text", () => {
    const store = new VariableStore();
    store.set("d", new Date(Date.UTC(2009, 4, 5)));
    store.set("m", new Map([["a", "b"]]));
    store.set("obj", { toString: () => "obj" });
    store.set("b", true);
    store.set("big", 10n);

    expect(store.get("d")?.text).toBe("05-May-2009");
    expect(store.get("m")?.text).toContain('class="hash_table"');
    expect(store.get("obj")?.text).toBe("obj");
    expect(store.get("b")?.text).toBe("true");
    expect(store.get("big")?.text).toBe("10");
  });

  it("clears all symbols", () => {
    const store = new VariableStore();
    store.set("v", "Bob");
    store.clear();
    expect(store.has("v")).toBe(false);
  });
});

describe("VariableStore symbol replacement", () => {
  it("returns the raw object for a whole-argument symbol", () => {
    const store = new VariableStore();
    const list = ["a", "b"];
    store.set("v", list);

    expect(store.replaceSymbols(["$v"])).toEqual([list]);
    expect(store.replaceSymbols(["$v"])[0]).toBe(list);
  });

  it("substitutes symbols inside a larger string", () => {
    const store = new VariableStore();
    store.set("v", "Bob");

    expect(store.replaceSymbols(["name: $v"])).toEqual(["name: Bob"]);
    expect(store.replaceSymbolsInString("name: $v")).toBe("name: Bob");
  });

  it("leaves unknown symbols untouched", () => {
    const store = new VariableStore();
    expect(store.replaceSymbols(["name: $nope"])).toEqual(["name: $nope"]);
  });

  it("applies the prefix rule", () => {
    const store = new VariableStore();
    store.set("v", "Bob");
    expect(store.replaceSymbols(["$v1"])).toEqual(["Bob1"]);
  });

  it("replaces symbols inside nested lists", () => {
    const store = new VariableStore();
    store.set("v", "Bob");
    expect(store.replaceSymbols([["$v", "x"], "$v"])).toEqual([["Bob", "x"], "Bob"]);
  });

  it("turns symbol assignments into the empty string", () => {
    const store = new VariableStore();
    expect(store.replaceSymbols(["$x ="])).toEqual([""]);
    expect(store.replaceSymbolsInString("$x =")).toBe("");
  });

  it("returns the raw value for non-string symbols", () => {
    const store = new VariableStore();
    store.set("n", 7);
    store.set("nil", null);

    expect(store.replaceSymbols(["$n"])).toEqual([7]);
    expect(store.replaceSymbols(["$nil"])).toEqual([null]);
  });

  it("reports whether a whole-argument symbol is stored", () => {
    const store = new VariableStore();
    store.set("v", "Bob");

    expect(store.containsValueFor("$v")).toBe(true);
    expect(store.containsValueFor("$other")).toBe(false);
    expect(store.containsValueFor("v")).toBe(false);
  });

  it("does not evaluate backtick expressions", () => {
    const store = new VariableStore();
    expect(store.replaceSymbols(["$`1+1`"])).toEqual(["$`1+1`"]);
  });
});
