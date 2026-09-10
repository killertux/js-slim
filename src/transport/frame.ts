import { Buffer } from "node:buffer";
import type { Readable, Writable } from "node:stream";

import { MINIMUM_NUMBER_LENGTH } from "../protocol/length.js";
import { SlimTransportError } from "./errors.js";

/** SLiM protocol version implemented by this harness. */
export const PROTOCOL_VERSION = "0.5";

/** The un-prefixed, newline-terminated version header sent on connect. */
export const SLIM_HEADER = `Slim -- V${PROTOCOL_VERSION}\n`;

/** The directive that ends a SLiM session. */
export const BYE_MESSAGE = "bye";

/** Largest number of digits accepted in a message length prefix. */
const MAX_LENGTH_PREFIX_DIGITS = 15;

/** A duplex, message-framed SLiM connection. */
export interface SlimConnection {
  /** Write the un-prefixed version header. */
  writeHeader(): void;
  /** Read the next framed message, or `null` on a clean EOF. */
  readMessage(): Promise<string | null>;
  /** Write a byte-length-prefixed message. */
  writeMessage(payload: string): void;
  /** Release the underlying connection. */
  close(): Promise<void>;
}

/** @returns true when `message` is the `bye` directive (case-insensitive). */
export function isByeMessage(message: string): boolean {
  return message.toLowerCase() === BYE_MESSAGE;
}

/**
 * Frame a payload for the wire.
 *
 * The prefix is a colon-terminated byte length of at least
 * {@link MINIMUM_NUMBER_LENGTH} ASCII digits. Note that this differs from the
 * list codec, whose internal lengths are UTF-16 code units.
 */
export function encodeFrame(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const prefix = `${String(body.byteLength).padStart(MINIMUM_NUMBER_LENGTH, "0")}:`;
  return Buffer.concat([Buffer.from(prefix, "ascii"), body]);
}

/** Write the un-prefixed version header. */
export function writeHeader(output: Writable): void {
  output.write(SLIM_HEADER);
}

/** Write a byte-length-prefixed message. */
export function writeFrame(output: Writable, payload: string): void {
  output.write(encodeFrame(payload));
}

/**
 * Incremental reader for framed SLiM messages.
 *
 * Handles arbitrary chunk boundaries and reads exactly the declared number of
 * bytes. {@link readLine} is provided for the un-prefixed version header.
 */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer | string>;
  private finished = false;

  constructor(readable: Readable) {
    this.iterator = readable[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
  }

  /** Read a newline-terminated line (used for the un-prefixed header). */
  async readLine(): Promise<string | null> {
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);

      if (newline >= 0) {
        const line = this.buffer.subarray(0, newline).toString("utf8");
        this.buffer = this.buffer.subarray(newline + 1);
        return line.endsWith("\r") ? line.slice(0, -1) : line;
      }

      if (!(await this.fill())) {
        if (this.buffer.length === 0) {
          return null;
        }
        const remainder = this.buffer.toString("utf8");
        this.buffer = Buffer.alloc(0);
        return remainder;
      }
    }
  }

  /** Read the next framed message, or `null` on a clean EOF. */
  async readMessage(): Promise<string | null> {
    let colon = -1;

    for (;;) {
      colon = this.buffer.indexOf(0x3a);
      if (colon >= 0) {
        if (colon < MINIMUM_NUMBER_LENGTH) {
          throw new SlimTransportError("SLiM length prefix must be at least 6 digits");
        }
        if (colon > MAX_LENGTH_PREFIX_DIGITS) {
          throw new SlimTransportError("SLiM length prefix is too long");
        }
        break;
      }

      if (this.buffer.length > MAX_LENGTH_PREFIX_DIGITS) {
        throw new SlimTransportError("SLiM length prefix is missing its ':' terminator");
      }

      if (!(await this.fill())) {
        if (this.buffer.length === 0) {
          return null;
        }
        throw new SlimTransportError("Stream ended before the SLiM length prefix was complete");
      }
    }

    const digits = this.buffer.subarray(0, colon).toString("ascii");
    if (!/^\d+$/.test(digits)) {
      throw new SlimTransportError(`Invalid SLiM length prefix: ${JSON.stringify(digits)}`);
    }

    const length = Number(digits);
    if (!Number.isSafeInteger(length)) {
      throw new SlimTransportError(`Invalid SLiM message length: ${digits}`);
    }

    const total = colon + 1 + length;
    while (this.buffer.length < total) {
      if (!(await this.fill())) {
        throw new SlimTransportError("Stream ended before the SLiM message was complete");
      }
    }

    const payload = this.buffer.subarray(colon + 1, total).toString("utf8");
    this.buffer = this.buffer.subarray(total);
    return payload;
  }

  private async fill(): Promise<boolean> {
    if (this.finished) {
      return false;
    }

    const next = await this.iterator.next();
    if (next.done) {
      this.finished = true;
      return false;
    }

    const value = next.value;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    return true;
  }
}
