import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createFixtureLoader, EXIT_STARTUP_FAILURE, runCli } from "../src/cli.js";
import { deserialize } from "../src/protocol/deserializer.js";
import { serialize } from "../src/protocol/serializer.js";
import type { SlimSerializable } from "../src/protocol/types.js";
import { ExecutionContext } from "../src/runtime/execution-context.js";
import { FixtureLoader, type FixtureConstructor } from "../src/runtime/fixture-loader.js";
import { currentFixtureLoader } from "../src/runtime/fixture-scope.js";
import { StatementExecutor } from "../src/runtime/statement-executor.js";
import { SlimServer } from "../src/server.js";
import type { SlimConnection } from "../src/transport/frame.js";

const nativeImport = (specifier: string) => import(specifier);

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const CLASH = join(FIXTURES, "clash");

/**
 * Plays a scripted conversation: each batch is sent only after the previous
 * response was written, like FitNesse or Temoc driving one connection.
 */
class ScriptedConnection implements SlimConnection {
  readonly responses: SlimSerializable[][] = [];
  closed = false;
  private readonly batches: string[];

  constructor(batches: readonly (readonly SlimSerializable[])[]) {
    this.batches = batches.map((batch) => serialize(batch));
  }

  writeHeader(): void {}

  async readMessage(): Promise<string | null> {
    return this.batches.shift() ?? "bye";
  }

  writeMessage(payload: string): void {
    this.responses.push(deserialize(payload) as SlimSerializable[]);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Run `batches` through the stock CLI in pipe mode and return each batch's rows. */
async function serveThroughCli(
  argv: readonly string[],
  batches: readonly (readonly SlimSerializable[])[],
): Promise<{ code: number; responses: SlimSerializable[][]; stderr: string }> {
  const connection = new ScriptedConnection(batches);
  let stderr = "";
  const code = await runCli(argv, {
    io: {
      stderr: (text) => {
        stderr += text;
      },
    },
    // The CLI's own loader wiring, with Vitest's native import (see the loader tests).
    createServer: (options) =>
      new SlimServer({ fixtureLoader: createFixtureLoader(options, { importer: nativeImport }) }),
    createStdioConnection: () => connection,
  });
  return { code, responses: connection.responses, stderr };
}

/** One Temoc spec file: `beginFile`, its imports, then a `Clash` fixture. */
function specFile(id: string, imports: readonly string[]): SlimSerializable[] {
  return [
    [`${id}_hook`, "call", "hooks", "beginFile"],
    ...imports.map((path, index) => [`${id}_i${index}`, "import", path]),
    [`${id}_m`, "make", `clash_${id}`, "Clash"],
    [`${id}_c`, "call", `clash_${id}`, "origin"],
  ];
}

function valueOf(rows: SlimSerializable[], id: string): SlimSerializable | undefined {
  return (rows.find((row) => Array.isArray(row) && row[0] === id) as SlimSerializable[])?.[1];
}

describe("createFixtureLoader", () => {
  it("applies --import values like import instructions, last one first", () => {
    const loader = createFixtureLoader({ imports: ["./a", "./b", "./a"] });
    expect(loader.paths).toEqual(["./a", "./b"]);

    const sequential = new FixtureLoader();
    for (const path of ["./a", "./b", "./a"]) sequential.addPath(path);
    expect(loader.paths).toEqual(sequential.paths);
  });

  it("restores the --import paths on reset", () => {
    const loader = createFixtureLoader({ imports: ["."] });
    loader.addPath("./a");
    loader.resetPaths();
    expect(loader.paths).toEqual(["."]);
  });

  it("starts with no paths without --import", () => {
    expect(createFixtureLoader({}).paths).toEqual([]);
  });

  it("rejects a --cwd that is not a directory", () => {
    expect(() => createFixtureLoader({ cwd: join(CLASH, "SpecHooks.js") })).toThrow(
      "--cwd is not a directory",
    );
    expect(() => createFixtureLoader({ cwd: join(CLASH, "missing") })).toThrow(
      "--cwd is not a directory",
    );
  });
});

describe("CLI --import and --cwd", () => {
  it("resolves a fixture before any import instruction", async () => {
    const { code, responses } = await serveThroughCli(
      ["--cwd", CLASH, "--import", "."],
      [[["m1", "make", "hooks", "SpecHooks"]]],
    );
    expect(code).toBe(0);
    expect(responses).toEqual([[["m1", "OK"]]]);
  });

  it("resolves relative import instructions against --cwd", async () => {
    const { responses } = await serveThroughCli(
      ["--cwd", CLASH],
      [
        [
          ["i1", "import", "./b"],
          ["m1", "make", "clash", "Clash"],
          ["c1", "call", "clash", "origin"],
        ],
      ],
    );
    expect(responses).toEqual([
      [
        ["i1", "OK"],
        ["m1", "OK"],
        ["c1", "b"],
      ],
    ]);
  });

  it("resolves a relative --cwd against the process directory", async () => {
    const relative = join(".", "test", "fixtures", "clash");
    expect(resolve(relative)).toBe(CLASH);
    const { responses } = await serveThroughCli(
      ["--cwd", relative, "--import", "."],
      [[["m1", "make", "hooks", "SpecHooks"]]],
    );
    expect(responses).toEqual([[["m1", "OK"]]]);
  });

  it("cannot find the hooks fixture without --import", async () => {
    const { responses } = await serveThroughCli(
      ["--cwd", CLASH],
      [[["m1", "make", "hooks", "SpecHooks"]]],
    );
    expect(String(valueOf(responses[0]!, "m1"))).toContain("COULD_NOT_INVOKE_CONSTRUCTOR");
  });

  it("exits 98 for a --cwd that is not a directory", async () => {
    const { code, stderr } = await serveThroughCli(["--cwd", join(CLASH, "missing")], []);
    expect(code).toBe(EXIT_STARTUP_FAILURE);
    expect(stderr).toContain("--cwd is not a directory");
  });
});

describe("namespaced fixtures on a persistent server", () => {
  it("gives a re-imported path precedence again (three files, one connection)", async () => {
    const { code, responses } = await serveThroughCli(
      ["--cwd", CLASH],
      [
        [
          ["f1_i", "import", "./a"],
          ["f1_m", "make", "c1", "Clash"],
          ["f1_c", "call", "c1", "origin"],
        ],
        [
          ["f2_i", "import", "./b"],
          ["f2_m", "make", "c2", "Clash"],
          ["f2_c", "call", "c2", "origin"],
        ],
        [
          ["f3_i", "import", "./a"],
          ["f3_m", "make", "c3", "Clash"],
          ["f3_c", "call", "c3", "origin"],
        ],
      ],
    );

    expect(code).toBe(0);
    expect([
      valueOf(responses[0]!, "f1_c"),
      valueOf(responses[1]!, "f2_c"),
      valueOf(responses[2]!, "f3_c"),
    ]).toEqual(["a", "b", "a"]);
  });

  it("lets a file hook reset the paths so each file sees only its own imports", async () => {
    const { code, responses } = await serveThroughCli(
      ["--cwd", CLASH, "--import", "."],
      [
        [["h", "make", "hooks", "SpecHooks"]],
        specFile("f1", ["./a"]),
        specFile("f2", ["./b"]),
        specFile("f3", ["./a"]),
        // Forgot its import: must not pass by accident with ./a from file 3.
        specFile("f4", []),
        // The hooks fixture itself still resolves from the --import root.
        [["h2", "make", "hooks2", "SpecHooks"]],
      ],
    );

    expect(code).toBe(0);
    expect(valueOf(responses[0]!, "h")).toBe("OK");
    expect(valueOf(responses[1]!, "f1_c")).toBe("a");
    expect(valueOf(responses[2]!, "f2_c")).toBe("b");
    expect(valueOf(responses[3]!, "f3_c")).toBe("a");
    expect(valueOf(responses[4]!, "f4_hook")).toBe("/__VOID__/");
    expect(String(valueOf(responses[4]!, "f4_m"))).toContain("COULD_NOT_INVOKE_CONSTRUCTOR Clash");
    expect(valueOf(responses[5]!, "h2")).toBe("OK");
  });
});

describe("currentFixtureLoader", () => {
  function executorWith(registry: Record<string, FixtureConstructor>, timeoutSeconds = 0) {
    const loader = new FixtureLoader({ resolver: (name) => registry[name] });
    const executor = new StatementExecutor({
      context: new ExecutionContext({ fixtureLoader: loader }),
      timeoutSeconds,
    });
    return { loader, executor };
  }

  it("is undefined outside an instruction", () => {
    expect(currentFixtureLoader()).toBeUndefined();
  });

  it.each([0, 5])(
    "is the session's loader in constructors and (async) methods (timeout %ss)",
    async (timeoutSeconds) => {
      const seen: unknown[] = [];
      class Probe {
        constructor() {
          seen.push(currentFixtureLoader());
        }
        async later(): Promise<void> {
          await new Promise((done) => setTimeout(done, 1));
          seen.push(currentFixtureLoader());
        }
      }
      const { loader, executor } = executorWith({ Probe }, timeoutSeconds);

      await executor.execute({
        kind: "make",
        id: "m",
        instanceName: "p",
        className: "Probe",
        args: [],
      });
      await executor.execute({
        kind: "call",
        id: "c",
        instanceName: "p",
        methodName: "later",
        args: [],
      });

      expect(seen).toEqual([loader, loader]);
      expect(currentFixtureLoader()).toBeUndefined();
    },
  );

  it("keeps two sessions' loaders apart", async () => {
    const seen: unknown[] = [];
    class Probe {
      async look(): Promise<void> {
        await new Promise((done) => setTimeout(done, 1));
        seen.push(currentFixtureLoader());
      }
    }
    const one = executorWith({ Probe });
    const two = executorWith({ Probe });
    for (const { executor } of [one, two]) {
      await executor.execute({
        kind: "make",
        id: "m",
        instanceName: "p",
        className: "Probe",
        args: [],
      });
    }

    await Promise.all(
      [one, two].map(({ executor }) =>
        executor.execute({
          kind: "call",
          id: "c",
          instanceName: "p",
          methodName: "look",
          args: [],
        }),
      ),
    );

    expect(seen).toContain(one.loader);
    expect(seen).toContain(two.loader);
  });
});
