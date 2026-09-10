import net from "node:net";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EXIT_BAD_ARGUMENTS,
  EXIT_OUT_OF_MEMORY,
  EXIT_STARTUP_FAILURE,
  isEntryPoint,
  main,
  parseArguments,
  runCli,
  USAGE,
} from "../src/cli.js";
import { deserialize } from "../src/protocol/deserializer.js";
import { serialize } from "../src/protocol/serializer.js";
import { ExecutionContext } from "../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../src/runtime/fixture-loader.js";
import { StatementExecutor } from "../src/runtime/statement-executor.js";
import { SlimServer } from "../src/server.js";
import type { SlimConnection } from "../src/transport/frame.js";
import type { RunningSocketServer, SocketServerOptions } from "../src/transport/socket.js";
import { SlimClient, toResultMap } from "../src/transport/client.js";
class TestFixture {
  addTo(a: number, b: number): number {
    return a + b;
  }
}

class FakeConnection implements SlimConnection {
  readonly written: string[] = [];
  closed = false;
  private readonly incoming: Array<string | null>;

  constructor(incoming: Array<string | null> = []) {
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
    this.closed = true;
  }
}

function makeServer(): SlimServer {
  const registry = new Map<string, FixtureConstructor>([["TestFixture", TestFixture]]);
  const loader = new FixtureLoader({ resolver: (name) => registry.get(name) });
  return new SlimServer({
    createExecutor: () =>
      new StatementExecutor({ context: new ExecutionContext({ fixtureLoader: loader }) }),
  });
}

function collect(): { lines: string[]; write: (text: string) => void } {
  const lines: string[] = [];
  return { lines, write: (text) => lines.push(text) };
}

describe("parseArguments", () => {
  it("defaults to pipe mode", () => {
    const result = parseArguments([]);
    expect(result).toEqual({
      ok: true,
      options: { verbose: false, daemon: false, help: false, port: null },
    });
  });

  it("treats port 1 as pipe mode", () => {
    const result = parseArguments(["1"]);
    expect(result.ok && result.options.port).toBe(null);
  });

  it("accepts a numeric port", () => {
    const result = parseArguments(["9123"]);
    expect(result.ok && result.options.port).toBe(9123);
  });

  it("accepts port 0 for an ephemeral port", () => {
    const result = parseArguments(["0"]);
    expect(result.ok && result.options.port).toBe(0);
  });

  it.each([
    [["-v"], { verbose: true }],
    [["--verbose"], { verbose: true }],
    [["-d"], { daemon: true }],
    [["--daemon"], { daemon: true }],
    [["-h"], { help: true }],
    [["--help"], { help: true }],
    [["-s", "5"], { timeoutSeconds: 5 }],
    [["-s5"], { timeoutSeconds: 5 }],
    [["-s=5"], { timeoutSeconds: 5 }],
    [["--timeout", "0.5"], { timeoutSeconds: 0.5 }],
    [["--timeout=0.5"], { timeoutSeconds: 0.5 }],
  ])("parses %j", (argv, expected) => {
    const result = parseArguments(argv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options).toMatchObject(expected);
    }
  });

  it.each([
    ["2147483", 2_147_483],
    ["0.05", 0.05],
    [".5", 0.5],
    ["+2", 2],
  ])("accepts a timeout of %s", (value, expected) => {
    const result = parseArguments(["-s", value]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.timeoutSeconds).toBe(expected);
    }
  });

  it("combines options and a port", () => {
    const result = parseArguments(["-v", "-d", "-s", "2", "8080"]);
    expect(result).toEqual({
      ok: true,
      options: { verbose: true, daemon: true, help: false, timeoutSeconds: 2, port: 8080 },
    });
  });

  it("stops option parsing at --", () => {
    const result = parseArguments(["--", "8080"]);
    expect(result.ok && result.options.port).toBe(8080);
  });

  it("treats a bare dash as a positional argument", () => {
    const result = parseArguments(["-"]);
    expect(result.ok).toBe(false);
  });

  it.each([
    [["-s"], "requires a value"],
    [["--timeout"], "requires a value"],
    [["-s", "abc"], "Invalid timeout"],
    [["-s", "0"], "Invalid timeout"],
    [["-s", "-1"], "Invalid timeout"],
    [["-s", "1e3"], "Invalid timeout"],
    [["-s", "0x10"], "Invalid timeout"],
    [["-s", "0b101"], "Invalid timeout"],
    [["-s", "  "], "Invalid timeout"],
    [["-s", "3000000"], "expected 0 < seconds <= 2147483"],
    [["-v=1"], "does not take a value"],
    [["-d=1"], "does not take a value"],
    [["-h=1"], "does not take a value"],
    [["--nope"], "Unknown option: --nope"],
    [["80x"], "Invalid port"],
    [["70000"], "Invalid port"],
    [["8080", "9090"], "Unexpected argument: 9090"],
  ])("rejects %j", (argv, message) => {
    const result = parseArguments(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(message);
    }
  });
});

describe("runCli", () => {
  it("prints usage and returns 97 for a bad command line", async () => {
    const stderr = collect();
    const code = await runCli(["--nope"], { io: { stderr: stderr.write } });

    expect(code).toBe(EXIT_BAD_ARGUMENTS);
    expect(stderr.lines.join("")).toContain("Unknown option: --nope");
    expect(stderr.lines.join("")).toContain(USAGE);
  });

  it("prints usage on stdout and returns 0 for -h", async () => {
    const stdout = collect();
    const code = await runCli(["-h"], { io: { stdout: stdout.write } });

    expect(code).toBe(0);
    expect(stdout.lines.join("")).toBe(USAGE);
  });

  it("serves pipe mode and closes the connection", async () => {
    const connection = new FakeConnection([
      serialize([
        ["m1", "make", "x", "TestFixture"],
        ["c1", "call", "x", "addTo", "2", "3"],
      ]),
      "bye",
    ]);

    const code = await runCli([], {
      createServer: () => makeServer(),
      createStdioConnection: () => connection,
    });

    expect(code).toBe(0);
    expect(connection.closed).toBe(true);
    expect(deserialize(connection.written[1] as string)).toEqual([
      ["m1", "OK"],
      ["c1", "5"],
    ]);
  });

  it("warns about -d in pipe mode", async () => {
    const stderr = collect();
    const connection = new FakeConnection(["bye"]);

    const code = await runCli(["-d"], {
      io: { stderr: stderr.write },
      createServer: () => makeServer(),
      createStdioConnection: () => connection,
    });

    expect(code).toBe(0);
    expect(stderr.lines.join("")).toContain("daemon flag is not supported");
  });

  it("serves one TCP connection and then stops", async () => {
    const connection = new FakeConnection([
      serialize([
        ["m1", "make", "x", "TestFixture"],
        ["c1", "call", "x", "addTo", "1", "1"],
      ]),
      "bye",
    ]);
    const stderr = collect();
    let closed = false;
    let seenPort: number | undefined;
    let seenDaemon: boolean | undefined;

    const code = await runCli(["-v", "9123"], {
      io: { stderr: stderr.write },
      createServer: () => makeServer(),
      startSocketServer: async (options: SocketServerOptions): Promise<RunningSocketServer> => {
        seenPort = options.port;
        seenDaemon = options.daemon;
        setTimeout(() => {
          void options.handleConnection(connection);
        }, 0);
        return {
          port: options.port,
          async close() {
            closed = true;
          },
        };
      },
    });

    expect(code).toBe(0);
    expect(seenPort).toBe(9123);
    expect(seenDaemon).toBe(false);
    expect(closed).toBe(true);
    expect(connection.closed).toBe(true);
    expect(deserialize(connection.written[1] as string)).toEqual([
      ["m1", "OK"],
      ["c1", "2"],
    ]);
    expect(stderr.lines.join("")).toContain("js-slim listening on port 9123");
  });

  it("keeps a daemon server running until aborted", async () => {
    const controller = new AbortController();
    let closed = false;

    const running = runCli(["-d", "9123"], {
      signal: controller.signal,
      io: { stderr: () => {} },
      createServer: () => makeServer(),
      startSocketServer: async (options) => ({
        port: options.port,
        async close() {
          closed = true;
        },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);

    controller.abort();
    expect(await running).toBe(0);
    expect(closed).toBe(true);
  });

  it("stops immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let closed = false;

    const code = await runCli(["-d", "9123"], {
      signal: controller.signal,
      createServer: () => makeServer(),
      startSocketServer: async (options) => ({
        port: options.port,
        async close() {
          closed = true;
        },
      }),
    });

    expect(code).toBe(0);
    expect(closed).toBe(true);
  });

  it("returns 98 when a connection handler fails", async () => {
    const stderr = collect();
    const failing: SlimConnection = {
      writeHeader: () => {},
      readMessage: async () => {
        throw new Error("malformed frame");
      },
      writeMessage: () => {},
      close: async () => {},
    };

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      createServer: () => makeServer(),
      startSocketServer: async (options) => {
        setTimeout(() => {
          void Promise.resolve(options.handleConnection(failing)).catch(() => {});
        }, 0);
        return { port: options.port, async close() {} };
      },
    });

    expect(code).toBe(EXIT_STARTUP_FAILURE);
    expect(stderr.lines.join("")).toContain("malformed frame");
  });

  it("maps a failing connection's out-of-memory error to 99", async () => {
    const stderr = collect();
    const failing: SlimConnection = {
      writeHeader: () => {},
      readMessage: async () => {
        throw new Error("JavaScript heap out of memory");
      },
      writeMessage: () => {},
      close: async () => {},
    };

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      createServer: () => makeServer(),
      startSocketServer: async (options) => {
        setTimeout(() => {
          void Promise.resolve(options.handleConnection(failing)).catch(() => {});
        }, 0);
        return { port: options.port, async close() {} };
      },
    });

    expect(code).toBe(EXIT_OUT_OF_MEMORY);
    expect(stderr.lines.join("")).toContain("Out of Memory. Aborting.");
  });

  it("keeps a daemon alive after a failing connection", async () => {
    const controller = new AbortController();
    const stderr = collect();
    const failing: SlimConnection = {
      writeHeader: () => {},
      readMessage: async () => {
        throw new Error("flaky client");
      },
      writeMessage: () => {},
      close: async () => {},
    };

    const running = runCli(["-d", "9123"], {
      signal: controller.signal,
      io: { stderr: stderr.write },
      createServer: () => makeServer(),
      startSocketServer: async (options) => {
        setTimeout(() => {
          void Promise.resolve(options.handleConnection(failing)).catch(() => {});
        }, 0);
        return { port: options.port, async close() {} };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    expect(await running).toBe(0);
    expect(stderr.lines.join("")).toContain("connection failed: Error: flaky client");
  });

  it("returns 98 and reports a bind failure", async () => {
    const stderr = collect();
    const error = Object.assign(new Error("listen EADDRINUSE: address already in use"), {
      code: "EADDRINUSE",
    });

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      startSocketServer: async () => {
        throw error;
      },
    });

    expect(code).toBe(EXIT_STARTUP_FAILURE);
    expect(stderr.lines.join("")).toContain("Can not bind to port 9123. Aborting.");
    expect(stderr.lines.join("")).toContain("js-slim failed:");
  });

  it("returns 98 for a non-Error throw", async () => {
    const stderr = collect();

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      startSocketServer: async () => {
        throw "boom";
      },
    });

    expect(code).toBe(EXIT_STARTUP_FAILURE);
    expect(stderr.lines.join("")).toContain("js-slim failed: boom");
  });

  it("falls back to the message when an error has no stack", async () => {
    const stderr = collect();
    const error = Object.assign(new Error("no stack"), { stack: undefined });

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      startSocketServer: async () => {
        throw error;
      },
    });

    expect(code).toBe(EXIT_STARTUP_FAILURE);
    expect(stderr.lines.join("")).toContain("js-slim failed: Error: no stack");
  });

  it.each([
    "JavaScript heap out of memory",
    "Array buffer allocation failed",
    "Invalid string length",
  ])("maps %j to exit 99", async (message) => {
    const stderr = collect();

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      startSocketServer: async () => {
        throw new Error(message);
      },
    });

    expect(code).toBe(EXIT_OUT_OF_MEMORY);
    expect(stderr.lines.join("")).toContain("Out of Memory. Aborting.");
  });

  it("maps the ERR_WORKER_OUT_OF_MEMORY code to exit 99", async () => {
    const stderr = collect();
    const error = Object.assign(new Error("worker died"), { code: "ERR_WORKER_OUT_OF_MEMORY" });

    const code = await runCli(["9123"], {
      io: { stderr: stderr.write },
      startSocketServer: async () => {
        throw error;
      },
    });

    expect(code).toBe(EXIT_OUT_OF_MEMORY);
    expect(stderr.lines.join("")).toContain("Out of Memory. Aborting.");
  });

  it("logs instructions with the default server when verbose", async () => {
    const stderr = collect();
    const connection = new FakeConnection([serialize([["a1", "assign", "x", "1"]]), "bye"]);

    const code = await runCli(["-v", "-s", "5"], {
      io: { stderr: stderr.write },
      createStdioConnection: () => connection,
    });

    expect(code).toBe(0);
    expect(stderr.lines.join("")).toContain("assign x 1");
  });

  it("writes to the process streams by default", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      expect(await runCli(["-h"])).toBe(0);
      expect(await runCli(["--nope"])).toBe(EXIT_BAD_ARGUMENTS);
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    }

    expect(stdout.join("")).toBe(USAGE);
    expect(stderr.join("")).toContain("Unknown option: --nope");
  });
});

describe("main", () => {
  it("records the exit code on the process", async () => {
    const stdout = collect();
    const previous = process.exitCode;
    process.exitCode = undefined;

    try {
      const code = await main(["-h"], { io: { stdout: stdout.write } });
      expect(code).toBe(0);
      expect(process.exitCode).toBe(0);
      expect(stdout.lines.join("")).toBe(USAGE);
    } finally {
      process.exitCode = previous;
    }
  });

  it("aborts a daemon server on SIGINT", async () => {
    let closed = false;
    const previous = process.exitCode;
    process.exitCode = undefined;

    try {
      const running = main(["-d", "9123"], {
        io: { stderr: () => {} },
        createServer: () => makeServer(),
        startSocketServer: async (options) => ({
          port: options.port,
          async close() {
            closed = true;
          },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      process.emit("SIGINT");

      expect(await running).toBe(0);
      expect(closed).toBe(true);
    } finally {
      process.exitCode = previous;
    }
  });

  it("keeps default signal handling in pipe mode", async () => {
    const before = process.listenerCount("SIGINT");
    const connection = new FakeConnection(["bye"]);

    try {
      const code = await main([], {
        createServer: () => makeServer(),
        createStdioConnection: () => connection,
      });

      expect(code).toBe(0);
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally {
      process.exitCode = undefined;
    }
  });
});

describe("isEntryPoint", () => {
  it("returns false without an entry path", () => {
    expect(isEntryPoint(undefined, import.meta.url)).toBe(false);
  });

  it("matches the current module", () => {
    expect(isEntryPoint(fileURLToPath(import.meta.url), import.meta.url)).toBe(true);
  });

  it("falls back to the raw path when realpath fails", () => {
    expect(isEntryPoint("/definitely/not/here.js", import.meta.url)).toBe(false);
    expect(isEntryPoint("/definitely/not/here.js", "file:///definitely/not/here.js")).toBe(true);
  });
});

describe("CLI end to end", () => {
  it("serves real TCP traffic and exits 0", async () => {
    const port = await freePort();
    const controller = new AbortController();
    const errors = collect();

    const running = runCli([String(port)], {
      signal: controller.signal,
      io: { stderr: errors.write },
      // Native dynamic import: Vitest's VM cannot run the `new Function` based
      // importer the loader picks when `__filename` is defined. The ESM build
      // (`dist/esm/cli.js`) always uses this native form anyway.
      createServer: () =>
        new SlimServer({
          fixtureLoader: new FixtureLoader({
            importer: (specifier) => import(/* @vite-ignore */ specifier),
          }),
        }),
    });

    let client: SlimClient | undefined;
    try {
      client = await connectWithRetry(port);
      expect(client.protocolVersion).toBe("0.5");

      const results = toResultMap(
        await client.invoke([
          ["i1", "import", "./test/fixtures"],
          ["m1", "make", "hello", "HelloFixture"],
          ["c1", "call", "hello", "noSuchMethod"],
        ]),
      );

      expect(results.get("m1")).toBe("OK");
      expect(String(results.get("c1"))).toContain("__EXCEPTION__:");

      await client.bye();
    } finally {
      await client?.close();
      controller.abort();
    }

    expect(await running).toBe(0);
    expect(errors.lines).toEqual([]);
  }, 15000);
});

/** Ask the OS for a free TCP port. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Connect, retrying while the freshly spawned server is still binding. */
async function connectWithRetry(port: number): Promise<SlimClient> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await SlimClient.connect({ port });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}
