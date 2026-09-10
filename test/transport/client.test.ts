import net from "node:net";

import { describe, expect, it } from "vitest";

import { SlimClient, toResultMap } from "../../src/transport/client.js";
import { SlimTransportError } from "../../src/transport/errors.js";

describe("toResultMap", () => {
  it("maps response rows by id", () => {
    const map = toResultMap([
      ["a", "1"],
      ["b", "OK"],
      ["c", "null"],
    ]);

    expect(map.get("a")).toBe("1");
    expect(map.get("b")).toBe("OK");
    expect(map.get("c")).toBe("null");
  });

  it("ignores malformed rows", () => {
    const map = toResultMap([["only-id"], "not-a-row", [1 as never, "wrong-id-type"]]);
    expect(map.size).toBe(0);
  });
});

describe("SlimClient.connect", () => {
  it("rejects when nothing is listening on the port", async () => {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
    const address = probe.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await expect(SlimClient.connect({ port })).rejects.toThrow();
  });

  it("throws when invoking after the connection is closed", async () => {
    const server = net.createServer((socket) => {
      socket.write("Slim -- V0.5\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    try {
      const client = await SlimClient.connect({ port });
      await client.close();
      await expect(client.invoke([["id"]])).rejects.toThrow(SlimTransportError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
