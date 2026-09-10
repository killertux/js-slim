import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// These tests exercise the shipped binary, so they need `pnpm build` first.
// CI builds before running coverage; a bare `pnpm test` skips them. The guard
// below also skips a *stale* build, so the suite can never report results for a
// binary that no longer matches `src`.
const CLI = fileURLToPath(new URL("../dist/esm/cli.js", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** Newest mtime of any `.ts` file under `directory`. */
function newestSourceMtime(directory: string): number {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.name.endsWith(".ts")) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

const BUILT = existsSync(CLI) && statSync(CLI).mtimeMs >= newestSourceMtime(join(REPO, "src"));

/**
 * The built library, typed against the sources so `pnpm typecheck` does not
 * require `dist` to exist.
 */
type Lib = typeof import("../src/index.js");

async function loadLib(): Promise<Lib> {
  const specifier = "../dist/esm/index.js";
  return (await import(/* @vite-ignore */ specifier)) as Lib;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(args: readonly string[], options: { input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stdin.end(options.input ?? "");
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Split the server's stream into its header line and framed messages. */
function parseStream(text: string): { header: string; frames: string[] } {
  const newline = text.indexOf("\n");
  const header = text.slice(0, newline);
  const frames: string[] = [];
  let index = newline + 1;

  while (index < text.length) {
    const colon = text.indexOf(":", index);
    if (colon === -1) break;
    const length = Number(text.slice(index, colon));
    frames.push(text.slice(colon + 1, colon + 1 + length));
    index = colon + 1 + length;
  }

  return { header, frames };
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Connect a raw socket, retrying while the spawned server is still binding. */
async function connectRaw(port: number): Promise<net.Socket> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      lastError = error;
      await delay(20);
    }
  }
  throw lastError;
}

/** The SLiM client, retrying while the spawned server is still binding. */
async function connectClient(
  lib: Lib,
  port: number,
): Promise<Awaited<ReturnType<Lib["SlimClient"]["connect"]>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await lib.SlimClient.connect({ port });
    } catch (error) {
      lastError = error;
      await delay(20);
    }
  }
  throw lastError;
}

function spawnServer(args: readonly string[]): {
  child: ReturnType<typeof spawn>;
  exited: Promise<number | null>;
  stderr: () => string;
} {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: REPO,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return {
    child,
    exited: new Promise<number | null>((resolve) => child.on("close", resolve)),
    stderr: () => stderr,
  };
}

describe.skipIf(!BUILT)("built CLI", () => {
  it("prints usage and exits 0 for -h", async () => {
    const { code, stdout } = await run(["-h"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: js-slim");
  });

  it("exits 97 for an unknown option", async () => {
    const { code, stderr } = await run(["--nope"]);
    expect(code).toBe(97);
    expect(stderr).toContain("Unknown option: --nope");
  });

  it("serves pipe mode with a real fixture and exits 0", async () => {
    const lib = await loadLib();
    const input = Buffer.concat([
      lib.encodeFrame(
        lib.serialize([
          ["i1", "import", "./test/fixtures"],
          ["m1", "make", "hello", "HelloFixture"],
          ["c1", "call", "hello", "noSuchMethod"],
          ["c2", "call", "hello", "toString"],
        ]),
      ),
      lib.encodeFrame("bye"),
    ]).toString("utf8");

    const { code, stdout, stderr } = await run([], { input });
    const { header, frames } = parseStream(stdout);
    const rows = lib.deserialize(frames[0] as string);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(header).toBe("Slim -- V0.5");
    expect(rows[0]).toEqual(["i1", "OK"]);
    expect(rows[1]).toEqual(["m1", "OK"]);
    expect(String(rows[2]?.[1])).toContain("__EXCEPTION__:");
  });

  it("serves a TCP session and exits 0 after bye", async () => {
    const lib = await loadLib();
    const port = await freePort();
    const server = spawnServer([String(port)]);

    try {
      const client = await connectClient(lib, port);
      const results = lib.toResultMap(
        await client.invoke([
          ["i1", "import", "./test/fixtures"],
          ["m1", "make", "hello", "HelloFixture"],
        ]),
      );
      expect(results.get("m1")).toBe("OK");
      await client.bye();
      await client.close();

      expect(await server.exited).toBe(0);
    } finally {
      server.child.kill("SIGKILL");
    }
  }, 20000);

  it("exits 98 when a connection sends a malformed frame", async () => {
    const port = await freePort();
    const server = spawnServer([String(port)]);

    const socket = await connectRaw(port).catch(async (error: unknown) => {
      server.child.kill("SIGKILL");
      throw error;
    });

    try {
      socket.on("error", () => {});
      // Wait for the server header so the session is definitely reading frames.
      await new Promise<void>((resolve) => socket.once("data", () => resolve()));
      // A 5-digit length prefix is below the protocol minimum.
      socket.write("12345:");

      expect(await server.exited).toBe(98);
      expect(server.stderr()).toContain("js-slim failed:");
    } finally {
      socket.destroy();
      server.child.kill("SIGKILL");
    }
  }, 20000);

  it("keeps a daemon serving several connections and exits 0 on SIGTERM", async () => {
    const lib = await loadLib();
    const port = await freePort();
    const server = spawnServer(["-d", String(port)]);

    try {
      for (let index = 0; index < 2; index += 1) {
        const client = await connectClient(lib, port);
        const results = lib.toResultMap(await client.invoke([["a1", "assign", "v", "1"]]));
        expect(results.get("a1")).toBe("OK");
        await client.bye();
        await client.close();
      }

      server.child.kill("SIGTERM");
      expect(await server.exited).toBe(0);
    } finally {
      server.child.kill("SIGKILL");
    }
  }, 20000);

  it("runs through a symlinked bin entry point", async () => {
    const directory = mkdtempSync(join(tmpdir(), "js-slim-bin-"));
    try {
      const link = join(directory, "js-slim");
      symlinkSync(CLI, link);

      const code = await new Promise<number | null>((resolve) => {
        const child = spawn(process.execPath, [link, "-h"], {
          stdio: ["ignore", "ignore", "ignore"],
        });
        child.on("close", resolve);
      });

      expect(code).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20000);
});
