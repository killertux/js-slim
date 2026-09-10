/** Error thrown when a serialized SLiM string cannot be parsed. */
export class SlimSyntaxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SlimSyntaxError";
  }
}
