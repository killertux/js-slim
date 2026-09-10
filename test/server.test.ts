import { describe, expect, it } from "vitest";

import { SlimClient, toResultMap } from "../src/transport/client.js";
import { startSocketServer } from "../src/transport/socket.js";
import { ExecutionContext } from "../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../src/runtime/fixture-loader.js";
import { StatementExecutor } from "../src/runtime/statement-executor.js";
import { SlimServer } from "../src/server.js";

class TestFixture {
  addTo(a: number, b: number): number {
    return a + b;
  }

  returnString(): string {
    return "string";
  }
}

function makeServer(): SlimServer {
  const registry = new Map<string, FixtureConstructor>([["TestFixture", TestFixture]]);
  const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
  return new SlimServer({ fixtureLoader: loader });
}

describe("SlimServer", () => {
  it("serves a full session over a socket", async () => {
    const server = makeServer();
    const running = await startSocketServer({
      port: 0,
      handleConnection: (connection) => server.serve(connection),
    });

    const client = await SlimClient.connect({ port: running.port });

    try {
      expect(client.protocolVersion).toBe("0.5");

      const results = toResultMap(
        await client.invoke([
          ["m1", "make", "x", "TestFixture"],
          ["c1", "call", "x", "addTo", "2", "3"],
          ["c2", "call", "x", "returnString"],
        ]),
      );

      expect(results.get("m1")).toBe("OK");
      expect(results.get("c1")).toBe("5");
      expect(results.get("c2")).toBe("string");

      await client.bye();
    } finally {
      await client.close();
      await running.close();
    }
  });

  it("handles multiple sequential connections", async () => {
    const server = makeServer();
    const running = await startSocketServer({
      port: 0,
      daemon: true,
      handleConnection: (connection) => server.serve(connection),
    });

    try {
      for (let index = 0; index < 2; index += 1) {
        const client = await SlimClient.connect({ port: running.port });
        try {
          const results = toResultMap(
            await client.invoke([["c1", "call", "missing", "addTo", "1", "2"]]),
          );
          expect(String(results.get("c1"))).toContain("__EXCEPTION__:");
          await client.bye();
        } finally {
          await client.close();
        }
      }
    } finally {
      await running.close();
    }
  });

  it("uses a custom executor factory per connection", async () => {
    const registry = new Map<string, FixtureConstructor>([["TestFixture", TestFixture]]);
    const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
    let created = 0;
    const server = new SlimServer({
      createExecutor: () => {
        created += 1;
        return new StatementExecutor({
          context: new ExecutionContext({ fixtureLoader: loader }),
        });
      },
    });

    const running = await startSocketServer({
      port: 0,
      handleConnection: (connection) => server.serve(connection),
    });

    const client = await SlimClient.connect({ port: running.port });
    try {
      await client.invoke([["m1", "make", "x", "TestFixture"]]);
      expect(created).toBe(1);
      await client.bye();
    } finally {
      await client.close();
      await running.close();
    }
  });
});
