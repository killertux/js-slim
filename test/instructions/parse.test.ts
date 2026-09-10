import { describe, expect, it } from "vitest";

import { SLIM_ERROR, SlimError } from "../../src/errors.js";
import { parseInstruction } from "../../src/instructions/parse.js";
import type { SlimValue } from "../../src/protocol/types.js";

describe("parseInstruction", () => {
  it("parses import", () => {
    expect(parseInstruction(["i1", "import", "my.fixtures"])).toEqual({
      kind: "import",
      id: "i1",
      path: "my.fixtures",
    });
  });

  it("parses make without arguments", () => {
    expect(parseInstruction(["m1", "make", "testSlim", "MyFixture"])).toEqual({
      kind: "make",
      id: "m1",
      instanceName: "testSlim",
      className: "MyFixture",
      args: [],
    });
  });

  it("parses make with arguments, including nested lists", () => {
    expect(parseInstruction(["m1", "make", "sut", "MyFixture", "3", ["a", "b"]])).toEqual({
      kind: "make",
      id: "m1",
      instanceName: "sut",
      className: "MyFixture",
      args: ["3", ["a", "b"]],
    });
  });

  it("parses call without arguments", () => {
    expect(parseInstruction(["c1", "call", "testSlim", "returnString"])).toEqual({
      kind: "call",
      id: "c1",
      instanceName: "testSlim",
      methodName: "returnString",
      args: [],
    });
  });

  it("parses call with arguments", () => {
    expect(parseInstruction(["c1", "call", "testSlim", "addTo", "1", "2"])).toEqual({
      kind: "call",
      id: "c1",
      instanceName: "testSlim",
      methodName: "addTo",
      args: ["1", "2"],
    });
  });

  it("parses callAndAssign", () => {
    expect(parseInstruction(["c1", "callAndAssign", "v", "testSlim", "addTo", "5", "6"])).toEqual({
      kind: "callAndAssign",
      id: "c1",
      symbolName: "v",
      instanceName: "testSlim",
      methodName: "addTo",
      args: ["5", "6"],
    });
  });

  it("parses assign", () => {
    expect(parseInstruction(["a1", "assign", "v", "value"])).toEqual({
      kind: "assign",
      id: "a1",
      symbolName: "v",
      value: "value",
    });
  });

  it("matches operations case-insensitively", () => {
    expect(parseInstruction(["i1", "IMPORT", "p"])).toMatchObject({ kind: "import" });
    expect(parseInstruction(["c1", "Call", "s", "m"])).toMatchObject({ kind: "call" });
    expect(parseInstruction(["c1", "CALLANDASSIGN", "v", "s", "m"])).toMatchObject({
      kind: "callAndAssign",
    });
  });

  it("returns an invalid instruction for an unknown operation", () => {
    expect(parseInstruction(["inv1", "invalidOperation"])).toEqual({
      kind: "invalid",
      id: "inv1",
      operation: "invalidOperation",
    });
  });

  it("preserves the original operation case for invalid instructions", () => {
    expect(parseInstruction(["id", "InvalidOperation"])).toEqual({
      kind: "invalid",
      id: "id",
      operation: "InvalidOperation",
    });
  });

  it("returns a fresh args array that does not alias the row", () => {
    const row = ["c1", "call", "s", "m", "1", "2"];
    const instruction = parseInstruction(row);
    if (instruction.kind !== "call") {
      throw new Error("expected a call instruction");
    }

    (instruction.args as SlimValue[]).push("3");
    expect(row).toEqual(["c1", "call", "s", "m", "1", "2"]);
  });
});

describe("parseInstruction malformed rows", () => {
  it("rejects an empty row", () => {
    expect(() => parseInstruction([])).toThrow(SlimError);
  });

  it("rejects a row without an instruction id and operation", () => {
    expect(() => parseInstruction(["onlyAnId"])).toThrow(SlimError);
  });

  it("reports the offending row in the message", () => {
    expect(() => parseInstruction(["id", "call", "notEnoughArguments"])).toThrow(
      "message:<<MALFORMED_INSTRUCTION [id,call,notEnoughArguments].>>",
    );
  });

  it("tags the error as MALFORMED_INSTRUCTION", () => {
    let caught: unknown;
    try {
      parseInstruction(["id", "import"]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SlimError);
    expect((caught as SlimError).tag).toBe(SLIM_ERROR.MALFORMED_INSTRUCTION);
  });

  it("rejects a non-string word in a fixed position", () => {
    expect(() => parseInstruction(["id", "make", "instance", ["not", "a", "string"]])).toThrow(
      SlimError,
    );
  });

  it("rejects a non-string assign value", () => {
    expect(() => parseInstruction(["a1", "assign", "v", ["x"]])).toThrow(SlimError);
  });

  it("ignores words after import's path", () => {
    expect(parseInstruction(["id", "import", "path", "extra"])).toEqual({
      kind: "import",
      id: "id",
      path: "path",
    });
  });

  it("rejects a row that is not a list", () => {
    expect(() => parseInstruction("not-a-row" as never)).toThrow(SlimError);
  });

  it("renders nested lists in the malformed message", () => {
    expect(() => parseInstruction(["id", ["x", "y"]])).toThrow(
      "message:<<MALFORMED_INSTRUCTION [id,[x, y]].>>",
    );
  });

  it("renders null words in the malformed message", () => {
    expect(() => parseInstruction(["id", null as never])).toThrow(
      "message:<<MALFORMED_INSTRUCTION [id,null].>>",
    );
  });
});
