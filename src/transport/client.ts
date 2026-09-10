import net from "node:net";

import { deserialize } from "../protocol/deserializer.js";
import { serialize } from "../protocol/serializer.js";
import type { SlimList, SlimSerializable, SlimValue } from "../protocol/types.js";
import { SlimTransportError } from "./errors.js";
import { BYE_MESSAGE, FrameReader, writeFrame } from "./frame.js";

/** The version prefix of the server's header line, e.g. `Slim -- V0.5`. */
const HEADER_PREFIX = "Slim -- V";

export interface SlimClientOptions {
  host?: string;
  port: number;
  /** Connection timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * A minimal FitNesse-side SLiM client.
 *
 * Used by the integration tests and as a debugging aid. It is intentionally
 * small: connect, perform the header handshake, exchange instruction/response
 * batches, and say `bye`.
 */
export class SlimClient {
  private constructor(
    private readonly socket: net.Socket,
    private readonly reader: FrameReader,
    /** The protocol version reported by the server, e.g. `0.5`. */
    readonly protocolVersion: string,
    private readonly errorState: { current: Error | null },
  ) {}

  static async connect(options: SlimClientOptions): Promise<SlimClient> {
    const { host = "127.0.0.1", port, timeoutMs } = options;
    const socket = await connectSocket(host, port, timeoutMs);
    const reader = new FrameReader(socket);

    // Keep a permanent error listener so a peer reset can never surface as an
    // uncaught exception; the recorded error is surfaced by assertWritable().
    const errorState: { current: Error | null } = { current: null };
    socket.on("error", (error: Error) => {
      errorState.current = error;
    });

    let header: string | null;
    try {
      header = await reader.readLine();
    } catch (error) {
      socket.destroy();
      throw error;
    }

    if (header === null) {
      socket.destroy();
      throw new SlimTransportError("SLiM server closed the connection before sending a header");
    }
    if (!header.startsWith(HEADER_PREFIX)) {
      socket.destroy();
      throw new SlimTransportError(`Unexpected SLiM header: ${JSON.stringify(header)}`);
    }

    return new SlimClient(socket, reader, header.slice(HEADER_PREFIX.length), errorState);
  }

  /** Send a batch of instructions and return the response rows. */
  async invoke(instructions: readonly SlimSerializable[]): Promise<SlimList> {
    this.assertWritable();
    writeFrame(this.socket, serialize(instructions));

    const message = await this.reader.readMessage();
    if (message === null) {
      throw new SlimTransportError("SLiM server closed the connection");
    }
    return deserialize(message);
  }

  /** Send the `bye` directive. The server is expected to close afterwards. */
  async bye(): Promise<void> {
    this.assertWritable();
    writeFrame(this.socket, BYE_MESSAGE);
  }

  /** Close the underlying connection. */
  async close(): Promise<void> {
    if (!this.socket.destroyed) {
      await new Promise<void>((resolve) => {
        this.socket.end(() => resolve());
      });
    }
    this.socket.destroy();
  }

  private assertWritable(): void {
    const error = this.errorState.current;
    if (error !== null) {
      throw new SlimTransportError(`SLiM connection error: ${error.message}`, { cause: error });
    }
    if (this.socket.destroyed || this.socket.writableEnded) {
      throw new SlimTransportError("SLiM connection is closed");
    }
  }
}

/** Convert response rows into an id-keyed map, for concise assertions. */
export function toResultMap(rows: SlimList): Map<string, SlimValue> {
  const map = new Map<string, SlimValue>();

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) {
      continue;
    }
    const id = row[0];
    const value = row[1];
    if (typeof id === "string" && value !== undefined) {
      map.set(id, value);
    }
  }

  return map;
}

function connectSocket(host: string, port: number, timeoutMs?: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    // Kept attached after connect so a later failure still has a listener; it
    // becomes a no-op once the connection has been established.
    socket.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(error);
    });

    if (timeoutMs !== undefined) {
      socket.setTimeout(timeoutMs, () => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        reject(new SlimTransportError(`Timed out connecting to ${host}:${port}`));
      });
    }

    socket.once("connect", () => {
      settled = true;
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}
