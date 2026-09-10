import net from "node:net";

import { describe, expect, it } from "vitest";

import { SlimClient, toResultMap } from "../../src/transport/client.js";

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
});
