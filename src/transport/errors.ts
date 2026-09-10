/** Error thrown for SLiM transport/framing failures. */
export class SlimTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SlimTransportError";
  }
}
