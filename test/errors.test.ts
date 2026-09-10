import { describe, expect, it } from "vitest";

import {
  ABORT_SLIM_SUITE_TAG,
  ABORT_SLIM_TEST_TAG,
  EXCEPTION_TAG,
  IGNORE_ALL_TESTS_TAG,
  IGNORE_SCRIPT_TEST_TAG,
  PRETTY_PRINT_END,
  PRETTY_PRINT_START,
  SLIM_ERROR,
  SlimError,
  formatSlimMessage,
} from "../src/errors.js";

describe("formatSlimMessage", () => {
  it("wraps a message in the pretty-print markers", () => {
    expect(formatSlimMessage("Can't convert foo to integer.")).toBe(
      `${PRETTY_PRINT_START}Can't convert foo to integer.${PRETTY_PRINT_END}`,
    );
  });

  it("prefixes a standard tag when given", () => {
    expect(formatSlimMessage("Foo", SLIM_ERROR.NO_CLASS)).toBe("message:<<NO_CLASS Foo>>");
  });

  it("omits an empty tag without adding a stray space", () => {
    expect(formatSlimMessage("boom", "")).toBe("message:<<boom>>");
  });
});

describe("exception tags", () => {
  it("builds the abort/ignore tags from the exception prefix", () => {
    expect(EXCEPTION_TAG).toBe("__EXCEPTION__:");
    expect(ABORT_SLIM_TEST_TAG).toBe("__EXCEPTION__:ABORT_SLIM_TEST:");
    expect(ABORT_SLIM_SUITE_TAG).toBe("__EXCEPTION__:ABORT_SLIM_SUITE:");
    expect(IGNORE_SCRIPT_TEST_TAG).toBe("__EXCEPTION__:IGNORE_SCRIPT_TEST:");
    expect(IGNORE_ALL_TESTS_TAG).toBe("__EXCEPTION__:IGNORE_ALL_TESTS:");
  });
});

describe("SlimError", () => {
  it("defaults to no tag and no pretty print", () => {
    const error = new SlimError("boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SlimError");
    expect(error.message).toBe("boom");
    expect(error.tag).toBeNull();
    expect(error.prettyPrint).toBe(false);
  });

  it("keeps the tag, pretty print flag and cause", () => {
    const cause = new Error("cause");
    const error = new SlimError("boom", {
      tag: SLIM_ERROR.TIMED_OUT,
      prettyPrint: true,
      cause,
    });

    expect(error.tag).toBe(SLIM_ERROR.TIMED_OUT);
    expect(error.prettyPrint).toBe(true);
    expect(error.cause).toBe(cause);
  });
});
