import net from "node:net";

import { deserialize } from "../protocol/deserializer.js";
import { serialize } from "../protocol/serializer.js";
import type { SlimList, SlimSerializable, SlimValue } from "../protocol/types.js";
import { SlimTransportError } from "./errors.js";
import { BYE_MESSAGE, FrameReader, encodeFrame } from "./frame.js";

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
  ) {}

  static async connect(options: SlimClientOptions): Promise<SlimClient> {
    const { host = "127.0.0.1", port, timeoutMs } = options;
    const socket = await connectSocket(host, port, timeoutMs);
    const reader = new FrameReader(socket);

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

    return new SlimClient(socket, reader, header.slice(HEADER_PREFIX.length));
  }

  /** Send a batch of instructions and return the response rows. */
  async invoke(instructions: readonly SlimSerializable[]): Promise<SlimList> {
    this.socket.write(encodeFrame(serialize(instructions)));

    const message = await this.reader.readMessage();
    if (message === null) {
      throw new SlimTransportError("SLiM server closed the connection");
    }
    return deserialize(message);
  }

  /** Send the `bye` directive. The server is expected to close afterwards. */
  async bye(): Promise<void> {
    this.socket.write(encodeFrame(BYE_MESSAGE));
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

    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.once("error", onError);

    if (timeoutMs !== undefined) {
      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        reject(new SlimTransportError(`Timed out connecting to ${host}:${port}`));
      });
    }

    socket.once("connect", () => {
      socket.off("error", onError);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}
