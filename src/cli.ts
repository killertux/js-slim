#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { FixtureLoader } from "./runtime/fixture-loader.js";
import { SlimServer } from "./server.js";
import type { SlimConnection } from "./transport/frame.js";
import {
  startSocketServer,
  type RunningSocketServer,
  type SocketServerOptions,
} from "./transport/socket.js";
import { createStdioConnection } from "./transport/stdio.js";

/** Exit code for an unparsable command line (Java `SlimService` parity). */
export const EXIT_BAD_ARGUMENTS = 97;
/** Exit code for a failure while starting or running the server. */
export const EXIT_STARTUP_FAILURE = 98;
/** Exit code for an out-of-memory abort. */
export const EXIT_OUT_OF_MEMORY = 99;

/** The port number that selects stdin/stdout pipe mode. */
export const STDIO_PORT = 1;

export const USAGE = `Usage: js-slim [options] [port]

Runs a SLiM server for FitNesse.

Arguments:
  port                 TCP port to listen on. Omit (or pass ${STDIO_PORT}) for stdin/stdout pipe mode.

Options:
  -v, --verbose        Log every instruction and result to stderr
  -s, --timeout <sec>  Per-instruction timeout in seconds (fractions allowed)
  -d, --daemon         Keep listening after the first connection (TCP mode only)
  -h, --help           Show this help and exit

Exit codes: 0 success, ${EXIT_BAD_ARGUMENTS} bad arguments, ${EXIT_STARTUP_FAILURE} startup failure, ${EXIT_OUT_OF_MEMORY} out of memory.
`;

export interface CliOptions {
  verbose: boolean;
  daemon: boolean;
  help: boolean;
  /** Per-instruction timeout in seconds, when `-s`/`--timeout` was given. */
  timeoutSeconds?: number;
  /** TCP port, or `null` for stdin/stdout pipe mode. */
  port: number | null;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; error: string };

/** Writable sinks, injectable so the CLI can be tested without touching stdout. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliDependencies {
  io?: Partial<CliIo>;
  /** Aborts the server; the entry point wires this to `SIGINT`/`SIGTERM`. */
  signal?: AbortSignal;
  /** Builds the server. Defaults to a {@link SlimServer} with a fresh loader. */
  createServer?: (options: CliOptions) => SlimServer;
  /** Defaults to {@link createStdioConnection}. */
  createStdioConnection?: () => SlimConnection;
  /** Defaults to {@link startSocketServer}. */
  startSocketServer?: (options: SocketServerOptions) => Promise<RunningSocketServer>;
}

// Captured before any stdio tunnel can patch the process streams, so CLI
// diagnostics always reach the real stderr instead of the protocol tunnel.
const writeToStdout = (text: string): void => {
  process.stdout.write(text);
};
const writeToStderr = (text: string): void => {
  process.stderr.write(text);
};

/**
 * Parse the command line.
 *
 * Accepts the Java option set (`-v`, `-s <seconds>`, `-d`, port) with long
 * aliases, `--opt=value` and attached short values (`-s5`). A missing port and
 * port `1` both mean pipe mode, matching `SlimService`.
 */
export function parseArguments(argv: readonly string[]): ParseResult {
  let verbose = false;
  let daemon = false;
  let help = false;
  let timeoutSeconds: number | undefined;
  let optionsEnded = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;

    if (optionsEnded || !argument.startsWith("-") || argument === "-") {
      positional.push(argument);
      continue;
    }

    if (argument === "--") {
      optionsEnded = true;
      continue;
    }

    const [name, inlineValue] = splitOption(argument);

    switch (name) {
      case "-v":
      case "--verbose":
        if (inlineValue !== undefined) return fail(`Option ${name} does not take a value`);
        verbose = true;
        break;
      case "-d":
      case "--daemon":
        if (inlineValue !== undefined) return fail(`Option ${name} does not take a value`);
        daemon = true;
        break;
      case "-h":
      case "--help":
        if (inlineValue !== undefined) return fail(`Option ${name} does not take a value`);
        help = true;
        break;
      case "-s":
      case "--timeout": {
        let value = inlineValue;
        if (value === undefined) {
          index += 1;
          value = argv[index];
        }
        if (value === undefined) return fail(`Option ${name} requires a value`);
        const seconds = Number(value);
        if (value.trim().length === 0 || !Number.isFinite(seconds) || seconds <= 0) {
          return fail(`Invalid timeout: ${value} (expected a positive number of seconds)`);
        }
        timeoutSeconds = seconds;
        break;
      }
      default:
        return fail(`Unknown option: ${argument}`);
    }
  }

  if (positional.length > 1) {
    return fail(`Unexpected argument: ${String(positional[1])}`);
  }

  let port: number | null = null;
  const rawPort = positional[0];
  if (rawPort !== undefined) {
    if (!/^\d+$/.test(rawPort)) return fail(`Invalid port: ${rawPort}`);
    const parsed = Number(rawPort);
    if (parsed > 65535) return fail(`Invalid port: ${rawPort} (expected 0-65535)`);
    port = parsed === STDIO_PORT ? null : parsed;
  }

  return {
    ok: true,
    options: {
      verbose,
      daemon,
      help,
      port,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    },
  };
}

/**
 * Run the CLI and return its exit code.
 *
 * Never throws: argument errors, bind failures and unexpected exceptions are
 * reported on stderr and mapped to {@link EXIT_BAD_ARGUMENTS} or
 * {@link EXIT_STARTUP_FAILURE}.
 */
export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const io: CliIo = {
    stdout: dependencies.io?.stdout ?? writeToStdout,
    stderr: dependencies.io?.stderr ?? writeToStderr,
  };

  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n\n${USAGE}`);
    return EXIT_BAD_ARGUMENTS;
  }

  const options = parsed.options;
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }

  const server = dependencies.createServer?.(options) ?? defaultServer(options, io);

  try {
    if (options.port === null) {
      await serveStdio(options, dependencies, io, server);
    } else {
      await serveTcp(options, dependencies, io, server);
    }
    return 0;
  } catch (error) {
    if (isOutOfMemoryError(error)) {
      io.stderr("Out of Memory. Aborting.\n");
      return EXIT_OUT_OF_MEMORY;
    }
    if (isAddressInUse(error)) {
      io.stderr(`Can not bind to port ${String(options.port)}. Aborting.\n`);
    }
    io.stderr(`js-slim failed: ${describeError(error)}\n`);
    return EXIT_STARTUP_FAILURE;
  }
}

/** Process entry point: run the CLI and record the exit code. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };

  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);

  try {
    const code = await runCli(argv, { ...dependencies, signal: controller.signal });
    process.exitCode = code;
    return code;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

/** Whether `entry` (usually `process.argv[1]`) is this module. */
export function isEntryPoint(entry: string | undefined, moduleUrl: string): boolean {
  if (entry === undefined) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return moduleUrl === pathToFileURL(entry).href;
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function fail(error: string): ParseResult {
  return { ok: false, error };
}

/** Split `--opt=value` / `-svalue` into a name and an optional inline value. */
function splitOption(argument: string): [string, string | undefined] {
  const equals = argument.indexOf("=");
  if (equals !== -1) {
    return [argument.slice(0, equals), argument.slice(equals + 1)];
  }
  if (!argument.startsWith("--") && argument.length > 2) {
    return [argument.slice(0, 2), argument.slice(2)];
  }
  return [argument, undefined];
}

function defaultServer(options: CliOptions, io: CliIo): SlimServer {
  return new SlimServer({
    fixtureLoader: new FixtureLoader(),
    verbose: options.verbose,
    logger: (message) => {
      io.stderr(`${message}\n`);
    },
    ...(options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
  });
}

async function serveStdio(
  options: CliOptions,
  dependencies: CliDependencies,
  io: CliIo,
  server: SlimServer,
): Promise<void> {
  if (options.daemon) {
    io.stderr("Warning: in Slim Pipe mode the daemon flag is not supported.\n");
  }
  const connection = (dependencies.createStdioConnection ?? createStdioConnection)();
  // `SlimServer.serve` closes the connection, restoring the output tunnel.
  await server.serve(connection);
}

async function serveTcp(
  options: CliOptions,
  dependencies: CliDependencies,
  io: CliIo,
  server: SlimServer,
): Promise<void> {
  const start = dependencies.startSocketServer ?? startSocketServer;
  const port = options.port as number;
  const signal = dependencies.signal;

  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });

  const running = await start({
    port,
    daemon: options.daemon,
    handleConnection: async (connection) => {
      await server.serve(connection);
      // Without `-d` the server serves exactly one connection, like Java's
      // `SlimService.acceptOne`.
      if (!options.daemon) finished();
    },
  });

  if (options.verbose) {
    io.stderr(`js-slim listening on port ${String(running.port)}\n`);
  }

  const onAbort = (): void => {
    finished();
    void running.close();
  };

  if (signal?.aborted === true) {
    onAbort();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    await done;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await running.close();
  }
}

const OUT_OF_MEMORY_PATTERN =
  /out of memory|heap limit|allocation failed|invalid string length|ERR_WORKER_OUT_OF_MEMORY/i;

function isOutOfMemoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ERR_WORKER_OUT_OF_MEMORY" ||
    OUT_OF_MEMORY_PATTERN.test(`${error.name}: ${error.message}`)
  );
}

function isAddressInUse(error: unknown): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === "EADDRINUSE";
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}

/* v8 ignore start -- only reachable when this file is the process entry point */
if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main();
}
/* v8 ignore stop */
