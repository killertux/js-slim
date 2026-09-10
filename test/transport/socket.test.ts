import net from "node:net";

import { describe, expect, it } from "vitest";

import { SlimClient } from "../../src/transport/client.js";
import { isByeMessage, type SlimConnection } from "../../src/transport/frame.js";
import { startSocketServer } from "../../src/transport/socket.js";

/** A minimal session handler that echoes framed instruction payloads back. */
async function echoConnection(connection: SlimConnection): Promise<void> {
  connection.writeHeader();

  for (;;) {
    const message = await connection.readMessage();
    if (message === null || isByeMessage(message)) {
      return;
    }
    connection.writeMessage(message);
  }
}

describe("startSocketServer", () => {
  it("serves one client and echoes framed batches", async () => {
    const server = await startSocketServer({ port: 0, handleConnection: echoConnection });
    const client = await SlimClient.connect({ port: server.port });

    try {
      expect(client.protocolVersion).toBe("0.5");

      const rows = [["id", "call", "fixture", "method", "1"]];
      await expect(client.invoke(rows)).resolves.toEqual(rows);

      await client.bye();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("accepts multiple clients in daemon mode", async () => {
    const server = await startSocketServer({
      port: 0,
      daemon: true,
      handleConnection: echoConnection,
    });

    try {
      for (let i = 0; i < 3; i += 1) {
        const client = await SlimClient.connect({ port: server.port });
        try {
          await expect(client.invoke([["id", "echo"]])).resolves.toEqual([["id", "echo"]]);
          await client.bye();
        } finally {
          await client.close();
        }
      }
    } finally {
      await server.close();
    }
  });

  it("rejects a peer that does not send a Slim header", async () => {
    const badServer = net.createServer((socket) => {
      socket.write("not a slim header\n");
      socket.end();
    });

    await new Promise<void>((resolve) => badServer.listen(0, "127.0.0.1", () => resolve()));
    const address = badServer.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    try {
      await expect(SlimClient.connect({ port })).rejects.toThrow(/header/i);
    } finally {
      await new Promise<void>((resolve) => badServer.close(() => resolve()));
    }
  });

  it("rejects when the port is already in use", async () => {
    const server = await startSocketServer({ port: 0, handleConnection: echoConnection });
    try {
      await expect(
        startSocketServer({ port: server.port, handleConnection: echoConnection }),
      ).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("lets a handler close its own connection", async () => {
    const server = await startSocketServer({
      port: 0,
      handleConnection: async (connection) => {
        connection.writeHeader();
        await connection.close();
      },
    });

    try {
      const client = await SlimClient.connect({ port: server.port });
      await client.close();
    } finally {
      await server.close();
    }
  });

  it("survives a handler that throws synchronously", async () => {
    const server = await startSocketServer({
      port: 0,
      daemon: true,
      handleConnection: () => {
        throw new Error("boom");
      },
    });

    try {
      await expect(SlimClient.connect({ port: server.port })).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("is safe to close twice", async () => {
    const server = await startSocketServer({ port: 0, handleConnection: echoConnection });
    await server.close();
    await server.close();
  });
});
