/**
 * Error tags defined by `fitnesse.slim.SlimServer`.
 */
export const SLIM_ERROR = {
  MALFORMED_INSTRUCTION: "MALFORMED_INSTRUCTION",
  NO_CLASS: "NO_CLASS",
  NO_INSTANCE: "NO_INSTANCE",
  NO_CONVERTER_FOR_ARGUMENT_NUMBER: "NO_CONVERTER_FOR_ARGUMENT_NUMBER",
  NO_CONSTRUCTOR: "NO_CONSTRUCTOR",
  NO_METHOD_IN_CLASS: "NO_METHOD_IN_CLASS",
  COULD_NOT_INVOKE_CONSTRUCTOR: "COULD_NOT_INVOKE_CONSTRUCTOR",
  TIMED_OUT: "TIMED_OUT",
} as const;

export type SlimErrorTag = (typeof SLIM_ERROR)[keyof typeof SLIM_ERROR];

/** Marker FitNesse renders as a highlighted message rather than a stack trace. */
export const PRETTY_PRINT_START = "message:<<";
export const PRETTY_PRINT_END = ">>";

/** Prefix of every exception response value (including abort/ignore tags). */
export const EXCEPTION_TAG = "__EXCEPTION__:";

/** Abort the current table / the whole suite. */
export const ABORT_SLIM_TEST_TAG = `${EXCEPTION_TAG}ABORT_SLIM_TEST:`;
export const ABORT_SLIM_SUITE_TAG = `${EXCEPTION_TAG}ABORT_SLIM_SUITE:`;

/** Skip the remaining script / test instructions. */
export const IGNORE_SCRIPT_TEST_TAG = `${EXCEPTION_TAG}IGNORE_SCRIPT_TEST:`;
export const IGNORE_ALL_TESTS_TAG = `${EXCEPTION_TAG}IGNORE_ALL_TESTS:`;

export interface SlimErrorOptions {
  /** Standard tag, when this maps onto a well-known SLiM failure. */
  tag?: SlimErrorTag;
  /** Whether the message should be wrapped in `message:<<...>>`. */
  prettyPrint?: boolean;
  cause?: unknown;
}

/**
 * Base class for SLiM protocol/runtime errors.
 *
 * Port of `fitnesse.slim.SlimError`. The message is stored verbatim and may
 * already be wrapped in `message:<<...>>` (the Java `InstructionFactory` embeds
 * the tag in the message); in that case `prettyPrint` stays false and
 * serialization must not re-apply the wrapper. Use {@link formatSlimMessage}
 * to build the `message:<<...>>` form for a fresh message.
 */
export class SlimError extends Error {
  readonly tag: SlimErrorTag | null;
  readonly prettyPrint: boolean;

  constructor(message: string, options: SlimErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SlimError";
    this.tag = options.tag ?? null;
    this.prettyPrint = options.prettyPrint ?? false;
  }
}

/**
 * Wrap a message the way FitNesse's pretty-print marker expects:
 * `message:<<TAG message>>` (the tag is omitted when empty).
 */
export function formatSlimMessage(message: string, tag?: string | null): string {
  const body = tag !== undefined && tag !== null && tag !== "" ? `${tag} ${message}` : message;
  return `${PRETTY_PRINT_START}${body}${PRETTY_PRINT_END}`;
}

/** Thrown by a fixture to abort the current slim test (`StopTest`). */
export class StopTestError extends Error {
  constructor(message = "", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StopTestError";
  }
}

/** Thrown by a fixture to abort the whole suite (`StopSuite`). */
export class StopSuiteError extends Error {
  constructor(message = "", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StopSuiteError";
  }
}

/** Thrown by a fixture to skip the rest of the script table. */
export class IgnoreScriptTestError extends Error {
  constructor(message = "", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IgnoreScriptTestError";
  }
}

/** Thrown by a fixture to ignore all remaining tests. */
export class IgnoreAllTestsError extends Error {
  constructor(message = "", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IgnoreAllTestsError";
  }
}

/** @returns true when the error's type name marks a `StopTest`. */
export function isStopTestError(error: unknown): boolean {
  return errorTypeName(error).includes("StopTest");
}

/** @returns true when the error's type name marks a `StopSuite`. */
export function isStopSuiteError(error: unknown): boolean {
  return errorTypeName(error).includes("StopSuite");
}

/** @returns true when the error's type name marks an `IgnoreScriptTest`. */
export function isIgnoreScriptTestError(error: unknown): boolean {
  return errorTypeName(error).includes("IgnoreScriptTest");
}

/** @returns true when the error's type name marks an `IgnoreAllTests`. */
export function isIgnoreAllTestsError(error: unknown): boolean {
  return errorTypeName(error).includes("IgnoreAllTests");
}

/** @returns true when the error aborts or skips the current execution. */
export function isStopOrIgnoreError(error: unknown): boolean {
  return (
    isStopTestError(error) ||
    isStopSuiteError(error) ||
    isIgnoreScriptTestError(error) ||
    isIgnoreAllTestsError(error)
  );
}

/**
 * Render an error as the protocol's `__EXCEPTION__:` response value.
 *
 * Abort/ignore errors use their dedicated marker; other errors include the
 * message and (when available) the stack and cause chain. Port of
 * `fitnesse.slim.SlimException#toString` plus `StackTraceEnricher`.
 */
export function formatException(error: unknown): string {
  if (isStopTestError(error)) {
    return exceptionMarker(ABORT_SLIM_TEST_TAG, rawMessage(error));
  }
  if (isStopSuiteError(error)) {
    return exceptionMarker(ABORT_SLIM_SUITE_TAG, rawMessage(error));
  }
  if (isIgnoreScriptTestError(error)) {
    return IGNORE_SCRIPT_TEST_TAG;
  }
  if (isIgnoreAllTestsError(error)) {
    return IGNORE_ALL_TESTS_TAG;
  }

  return `${EXCEPTION_TAG}${errorMessage(error)}${stackText(error)}`;
}

function exceptionMarker(tag: string, message: string): string {
  return message.length > 0 ? `${tag}${PRETTY_PRINT_START}${message}${PRETTY_PRINT_END}` : tag;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.length > 0 ? error.message : error.name;
  }
  return String(error);
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorTypeName(error: unknown): string {
  if (error instanceof Error) {
    const constructor = (error as { constructor?: { name?: unknown } }).constructor;
    const constructorName = typeof constructor?.name === "string" ? constructor.name : "";
    return constructorName.length > 0 && constructorName !== "Error" ? constructorName : error.name;
  }
  return "";
}

function stackText(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return "";
  }

  const parts: string[] = [];
  const frames = framesOf(error);
  if (frames.length > 0) {
    parts.push(frames);
  }

  // Some runtimes already append the cause chain to `stack`; do not repeat it.
  if (!error.stack.includes("Caused by:")) {
    const seen = new Set<unknown>();
    let cause: unknown = error.cause;
    while (cause instanceof Error && !seen.has(cause)) {
      seen.add(cause);
      parts.push(`Caused by: ${cause.name}: ${cause.message}${framesOf(cause)}`);
      cause = cause.cause;
    }
  }

  return parts.length > 0 ? `\n${parts.join("\n")}` : "";
}

/** The `at …` frames of a stack, without the duplicated `Name: message` header. */
function framesOf(error: Error): string {
  if (typeof error.stack !== "string") {
    return "";
  }
  const lines = error.stack.split("\n");
  const firstFrame = lines.findIndex((line) => line.trimStart().startsWith("at "));
  return firstFrame < 0 ? "" : `\n${lines.slice(firstFrame).join("\n")}`;
}
