import { describe, expect, it } from "vitest";

import {
  ABORT_SLIM_SUITE_TAG,
  ABORT_SLIM_TEST_TAG,
  EXCEPTION_TAG,
  IGNORE_ALL_TESTS_TAG,
  IGNORE_SCRIPT_TEST_TAG,
  IgnoreAllTestsError,
  IgnoreScriptTestError,
  PRETTY_PRINT_END,
  PRETTY_PRINT_START,
  SLIM_ERROR,
  SlimError,
  StopSuiteError,
  StopTestError,
  formatException,
  formatSlimMessage,
  isIgnoreAllTestsError,
  isIgnoreScriptTestError,
  isStopOrIgnoreError,
  isStopSuiteError,
  isStopTestError,
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

describe("stop and ignore errors", () => {
  it("detects marker classes", () => {
    expect(isStopTestError(new StopTestError())).toBe(true);
    expect(isStopTestError(new StopSuiteError())).toBe(false);
    expect(isStopSuiteError(new StopSuiteError())).toBe(true);
    expect(isIgnoreScriptTestError(new IgnoreScriptTestError())).toBe(true);
    expect(isIgnoreAllTestsError(new IgnoreAllTestsError())).toBe(true);
    expect(isStopOrIgnoreError(new StopTestError())).toBe(true);
    expect(isStopOrIgnoreError(new Error("boom"))).toBe(false);
  });

  it("detects marker names on plain errors", () => {
    const error = new Error("boom");
    error.name = "MyStopTestException";
    expect(isStopTestError(error)).toBe(true);
  });
});

describe("formatException", () => {
  it("formats a normal error with the exception marker", () => {
    expect(formatException(new Error("boom"))).toContain(`${EXCEPTION_TAG}boom`);
  });

  it("formats non-Error values", () => {
    expect(formatException("boom")).toBe(`${EXCEPTION_TAG}boom`);
  });

  it("formats abort and ignore errors with their marker", () => {
    expect(formatException(new StopTestError("why"))).toBe(`${ABORT_SLIM_TEST_TAG}message:<<why>>`);
    expect(formatException(new StopSuiteError())).toBe(ABORT_SLIM_SUITE_TAG);
    expect(formatException(new IgnoreScriptTestError("skip"))).toBe(IGNORE_SCRIPT_TEST_TAG);
    expect(formatException(new IgnoreAllTestsError("all"))).toBe(IGNORE_ALL_TESTS_TAG);
  });

  it("wraps a pre-wrapped message only once", () => {
    const error = new SlimError(formatSlimMessage("Foo", SLIM_ERROR.NO_CLASS), {
      tag: SLIM_ERROR.NO_CLASS,
    });
    const formatted = formatException(error);

    expect(formatted.startsWith(`${EXCEPTION_TAG}message:<<NO_CLASS Foo>>`)).toBe(true);
    expect(formatted.match(/message:<</g)).toHaveLength(1);
  });

  it("includes the cause chain", () => {
    const error = new SlimError("wrapped", {
      tag: SLIM_ERROR.NO_CLASS,
      cause: new Error("root cause"),
    });
    const formatted = formatException(error);

    expect(formatted).toContain(`${EXCEPTION_TAG}wrapped`);
    expect(formatted).toContain("Caused by:");
    expect(formatted).toContain("root cause");
  });
});
