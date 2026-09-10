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
