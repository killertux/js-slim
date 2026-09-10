/**
 * Standard SLiM error tags understood by FitNesse.
 *
 * Port of the `fitnesse.slim.SlimServer` constants.
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
 * Port of `fitnesse.slim.SlimError`. The message is stored verbatim; use
 * {@link formatSlimMessage} to build the `message:<<...>>` form FitNesse shows
 * to users.
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
export function formatSlimMessage(message: string, tag?: SlimErrorTag | null): string {
  const body = tag !== undefined && tag !== null ? `${tag} ${message}` : message;
  return `${PRETTY_PRINT_START}${body}${PRETTY_PRINT_END}`;
}
