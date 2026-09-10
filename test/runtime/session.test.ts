import { describe, expect, it } from "vitest";

import { deserialize } from "../../src/protocol/deserializer.js";
import { serialize } from "../../src/protocol/serializer.js";
import type { SlimList } from "../../src/protocol/types.js";
import { StopTestError } from "../../src/errors.js";
import { ExecutionContext } from "../../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../../src/runtime/fixture-loader.js";
import { Session, type SessionOptions } from "../../src/runtime/session.js";
import { StatementExecutor } from "../../src/runtime/statement-executor.js";
import type { SlimConnection } from "../../src/transport/frame.js";

class TestFixture {
  addTo(a: number, b: number): number {
    return a + b;
  }

  slow(): Promise<string> {
    return new Promise((resolve) => {
      setTimeout(() => resolve("done"), 80);
    });
  }

  listResult(): string[] {
    return ["a", "b"];
  }

  nullResult(): null {
    return null;
  }
}

class FakeConnection implements SlimConnection {
  readonly written: string[] = [];
  private readonly incoming: Array<string | null>;

  constructor(incoming: Array<string | null>) {
    this.incoming = incoming;
  }

  writeHeader(): void {
    this.written.push("HEADER");
  }

  async readMessage(): Promise<string | null> {
    return this.incoming.shift() ?? null;
  }

  writeMessage(payload: string): void {
    this.written.push(payload);
  }

  async close(): Promise<void> {
    // no-op
  }
}

function makeSession(options: SessionOptions & { timeoutSeconds?: number } = {}): Session {
  const registry = new Map<string, FixtureConstructor>([["TestFixture", TestFixture]]);
  const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
  const executor = new StatementExecutor({
    context: new ExecutionContext({ fixtureLoader: loader }),
    timeoutSeconds: options.timeoutSeconds,
  });
  return new Session(executor, options);
}

describe("Session", () => {
  it("writes the header, processes a batch and stops on bye", async () => {
    const connection = new FakeConnection([
      serialize([
        ["m1", "make", "x", "TestFixture"],
        ["c1", "call", "x", "addTo", "2", "3"],
      ]),
      "bye",
    ]);

    await makeSession().run(connection);

    expect(connection.written[0]).toBe("HEADER");
    expect(deserialize(connection.written[1] as string)).toEqual([
      ["m1", "OK"],
      ["c1", "5"],
    ]);
    expect(connection.written).toHaveLength(2);
  });

  it("stops on EOF", async () => {
    const connection = new FakeConnection([]);
    await makeSession().run(connection);
    expect(connection.written).toEqual(["HEADER"]);
  });

  it("handles several batches on one connection", async () => {
    const connection = new FakeConnection([
      serialize([["m1", "make", "x", "TestFixture"]]),
      serialize([["c1", "call", "x", "addTo", "1", "1"]]),
      "bye",
    ]);

    await makeSession().run(connection);

    expect(deserialize(connection.written[1] as string)).toEqual([["m1", "OK"]]);
    expect(deserialize(connection.written[2] as string)).toEqual([["c1", "2"]]);
  });

  it("stops on a case-insensitive bye", async () => {
    const connection = new FakeConnection([serialize([["m1", "make", "x", "TestFixture"]]), "BYE"]);

    await makeSession().run(connection);
    expect(connection.written).toHaveLength(2);
  });

  it("propagates a malformed frame error", async () => {
    const connection = new FakeConnection(["not-a-serialized-list"]);
    await expect(makeSession().run(connection)).rejects.toThrow();
  });

  it("handles a long sequence of instructions", async () => {
    const rows: SlimList[] = [["m1", "make", "x", "TestFixture"]];
    for (let index = 0; index < 1000; index += 1) {
      rows.push([`id_${index}`, "call", "x", "addTo", String(index), "1"]);
    }

    const results = await makeSession().handle(rows);

    expect(results).toHaveLength(1001);
    expect(results[1000]).toEqual(["id_999", "1000"]);
  });

  it("skips a malformed row that has no usable id", async () => {
    const results = await makeSession().handle([["m1", "make", "x", "TestFixture"], "not-a-list"]);
    expect(results).toEqual([["m1", "OK"]]);
  });

  it("turns a malformed instruction into an error row and keeps going", async () => {
    const results = await makeSession().handle([
      ["bad", "call", "onlyThreeWords"],
      ["m2", "make", "x", "TestFixture"],
    ]);

    expect(results[0]?.[0]).toBe("bad");
    expect(String(results[0]?.[1])).toContain("MALFORMED_INSTRUCTION");
    expect(results[1]).toEqual(["m2", "OK"]);
  });

  it("skips the remaining rows after a stop test error", async () => {
    class StopFixture {
      stop(): never {
        throw new StopTestError("stop");
      }
    }

    const registry = new Map<string, FixtureConstructor>([
      ["StopFixture", StopFixture],
      ["TestFixture", TestFixture],
    ]);
    const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
    const executor = new StatementExecutor({
      context: new ExecutionContext({ fixtureLoader: loader }),
    });

    const results = await new Session(executor).handle([
      ["m1", "make", "s", "StopFixture"],
      ["c1", "call", "s", "stop"],
      ["c2", "call", "s", "stop"],
    ]);

    expect(results).toHaveLength(2);
    expect(String(results[1]?.[1])).toContain("__EXCEPTION__:ABORT_SLIM_TEST:");
  });

  it("logs instructions when verbose", async () => {
    const messages: string[] = [];
    const session = makeSession({ verbose: true, logger: (message) => messages.push(message) });

    await session.handle([["m1", "make", "x", "TestFixture"]]);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).toContain("make x TestFixture");
  });

  it("describes every instruction kind when verbose", async () => {
    const messages: string[] = [];
    const session = makeSession({ verbose: true, logger: (message) => messages.push(message) });

    await session.handle([
      ["i1", "import", "/fixtures"],
      ["m1", "make", "x", "TestFixture"],
      ["a1", "assign", "v", "1"],
      ["c1", "call", "x", "addTo", "1", "2"],
      ["c2", "callAndAssign", "w", "x", "addTo", "1", "2"],
      ["c3", "call", "x", "listResult"],
      ["c4", "call", "x", "nullResult"],
      ["inv", "bogus"],
    ]);

    const log = messages.join("\n");
    expect(log).toContain("import /fixtures");
    expect(log).toContain("assign v 1");
    expect(log).toContain("callAndAssign w x addTo 1 2");
    expect(log).toContain("invalid bogus");
    expect(log).toContain('["a","b"]');
    expect(log).toContain("null");
  });

  it("does not log when not verbose", async () => {
    const messages: string[] = [];
    const session = makeSession({ logger: (message) => messages.push(message) });

    await session.handle([["m1", "make", "x", "TestFixture"]]);
    expect(messages).toEqual([]);
  });

  it("times out slow instructions", async () => {
    const session = makeSession({ timeoutSeconds: 0.05 });

    const results = await session.handle([
      ["m1", "make", "x", "TestFixture"],
      ["c1", "call", "x", "slow"],
    ]);

    expect(results[1]?.[0]).toBe("c1");
    expect(String(results[1]?.[1])).toContain("TIMED_OUT");
  });

  it("serializes a batch back to a framed string", async () => {
    const response = await makeSession().handleMessage(
      serialize([["m1", "make", "x", "TestFixture"]]),
    );
    expect(deserialize(response)).toEqual([["m1", "OK"]]);
  });
});

describe("Session error handling", () => {
  it("continues after ordinary errors", async () => {
    const registry = new Map<string, FixtureConstructor>([["TestFixture", TestFixture]]);
    const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
    const executor = new StatementExecutor({
      context: new ExecutionContext({ fixtureLoader: loader }),
    });
    const session = new Session(executor);

    // "missing" instance produces a normal error, not a stop; the batch continues.
    const rows: SlimList[] = [
      ["c1", "call", "missing", "addTo", "1", "2"],
      ["c2", "call", "missing", "addTo", "3", "4"],
    ];
    const results = await session.handle(rows);

    expect(results).toHaveLength(2);
    expect(String(results[0]?.[1])).toContain("NO_INSTANCE");
    expect(String(results[1]?.[1])).toContain("NO_INSTANCE");
  });
});
