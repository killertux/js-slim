import net from "node:net";
import type { AddressInfo } from "node:net";

import { FrameReader, SLIM_HEADER, encodeFrame, type SlimConnection } from "./frame.js";

export interface SocketServerOptions {
  /** TCP port to listen on. Use `0` to let the OS choose a free port. */
  port: number;
  /** Interface to bind. Defaults to `127.0.0.1`. */
  host?: string;
  /**
   * When true, keep accepting connections until {@link RunningSocketServer.close}
   * is called. When false (default), the server closes after the first
   * connection's handler resolves.
   */
  daemon?: boolean;
  /**
   * Called once per accepted connection. The handler owns the protocol loop
   * (writing the header, reading messages, responding, honouring `bye`).
   */
  handleConnection: (connection: SlimConnection) => void | Promise<void>;
}

export interface RunningSocketServer {
  /** The actual bound port (useful when `port: 0` was requested). */
  readonly port: number;
  /** Stop listening and dispose of any open connections. */
  close(): Promise<void>;
}

/**
 * Start a TCP SLiM server.
 *
 * A failing connection handler closes only that connection; other connections
 * are unaffected.
 */
export async function startSocketServer(
  options: SocketServerOptions,
): Promise<RunningSocketServer> {
  const { port, host = "127.0.0.1", daemon = false, handleConnection } = options;

  const sockets = new Set<net.Socket>();
  const tasks = new Set<Promise<void>>();
  const server = net.createServer();

  server.on("connection", (socket) => {
    socket.setNoDelay(true);
    sockets.add(socket);

    const connection = createSocketConnection(socket);
    const task = (async () => {
      try {
        await handleConnection(connection);
      } catch {
        // A failing handler must not take down the server; close its socket.
      } finally {
        sockets.delete(socket);
        socket.destroy();
        if (!daemon && server.listening) {
          server.close();
        }
      }
    })();

    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address() as AddressInfo | null;

  return {
    port: address?.port ?? port,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      for (const task of tasks) {
        await task;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Wrap a TCP socket as a {@link SlimConnection}. */
export function createSocketConnection(socket: net.Socket): SlimConnection {
  const reader = new FrameReader(socket);

  return {
    writeHeader() {
      socket.write(SLIM_HEADER);
    },
    readMessage() {
      return reader.readMessage();
    },
    writeMessage(payload: string) {
      socket.write(encodeFrame(payload));
    },
    async close() {
      socket.end();
    },
  };
}
