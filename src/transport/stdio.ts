import type { Readable, Writable } from "node:stream";
import { Writable as WritableStream } from "node:stream";

import { SlimTransportError } from "./errors.js";
import { FrameReader, SLIM_HEADER, encodeFrame, type SlimConnection } from "./frame.js";

/** Which tunnel a line of fixture output belongs to. */
export type TunnelLevel = "SOUT" | "SERR";

/** Receives already-prefixed tunnel output. */
export type TunnelSink = (text: string) => void;

/** Prefix for the first line of a record. */
const FIRST_LINE_PREFIX = ".:";

/** Prefix for the continuation lines of a record. */
const FOLLOWING_LINE_PREFIX = " :";

// Captured at module load so the true writers can always be restored, even if
// installation is attempted more than once. The bound variants are used for
// internal writes so protocol frames keep the correct `this`.
const PRISTINE_STDOUT_WRITE: typeof process.stdout.write = process.stdout.write;
const PRISTINE_STDERR_WRITE: typeof process.stderr.write = process.stderr.write;
const writeToStdout = PRISTINE_STDOUT_WRITE.bind(process.stdout);
const writeToStderr = PRISTINE_STDERR_WRITE.bind(process.stderr);

/** The restore function for the currently installed tunnel, if any. */
let activeTunnelRestore: (() => void) | null = null;

/**
 * Render a chunk of fixture output in the stdio-mode tunnel format.
 *
 * `console`/SUT writes are rerouted over stderr because stdout carries the
 * protocol. The first line is prefixed `<LEVEL>.:` and continuation lines
 * `<LEVEL> :`, matching the Java `LoggingOutputStream` so FitNesse can split
 * the stream back into stdout/stderr. Blank records produce no output.
 */
export function formatTunneledChunk(chunk: string, level: TunnelLevel): string {
  const record = chunk.replace(/\r?\n$/, "");

  if (record.length === 0) {
    return "";
  }

  const withContinuations = record.replaceAll("\n", `\n${level}${FOLLOWING_LINE_PREFIX}`);
  return `${level}${FIRST_LINE_PREFIX}${withContinuations}\n`;
}

/** A `Writable` that tunnels everything written to it through `sink`. */
export function createOutputTunnel(sink: TunnelSink, level: TunnelLevel): Writable {
  return new WritableStream({
    write(chunk: unknown, _encoding, callback) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const formatted = formatTunneledChunk(text, level);
      if (formatted.length > 0) {
        sink(formatted);
      }
      callback();
    },
  });
}

/**
 * Reroute `process.stdout` and `process.stderr` writes through `sink`.
 *
 * @returns a function that restores the original writers.
 */
export function installProcessOutputTunnel(sink: TunnelSink): () => void {
  if (activeTunnelRestore !== null) {
    throw new SlimTransportError("SLiM process output is already being tunneled");
  }

  const stdoutTunnel = createOutputTunnel(sink, "SOUT");
  const stderrTunnel = createOutputTunnel(sink, "SERR");

  const patch = (target: NodeJS.WriteStream, tunnel: Writable): void => {
    const patched = (chunk: unknown, encoding?: unknown, callback?: unknown): boolean => {
      if (typeof encoding === "function") {
        return tunnel.write(chunk, encoding as (error?: Error | null) => void);
      }
      if (encoding === undefined) {
        return tunnel.write(chunk, callback as ((error?: Error | null) => void) | undefined);
      }
      return tunnel.write(
        chunk,
        encoding as BufferEncoding,
        callback as ((error?: Error | null) => void) | undefined,
      );
    };
    target.write = patched as unknown as typeof target.write;
  };

  patch(process.stdout, stdoutTunnel);
  patch(process.stderr, stderrTunnel);

  let restored = false;
  const restore = (): void => {
    if (restored) {
      return;
    }
    restored = true;
    process.stdout.write = PRISTINE_STDOUT_WRITE;
    process.stderr.write = PRISTINE_STDERR_WRITE;
    if (activeTunnelRestore === restore) {
      activeTunnelRestore = null;
    }
  };

  activeTunnelRestore = restore;
  return restore;
}

export interface StdioConnectionOptions {
  /** Message input. Defaults to `process.stdin`. */
  input?: Readable;
  /** Protocol output (real stdout in production). Defaults to `process.stdout`. */
  output?: Writable;
  /** Destination for tunneled fixture output. Defaults to `process.stderr`. */
  tunnel?: Writable;
  /**
   * Whether to patch `process.stdout`/`process.stderr`. Defaults to true when
   * running against the real process streams, false when streams are injected.
   */
  redirectProcessOutput?: boolean;
}

/**
 * Create a SLiM connection over stdin/stdout (protocol "port 1" mode).
 *
 * Frames are read from `input` and written to `output`; fixture output is
 * tunneled to `tunnel`. When using the real process streams, global output is
 * rerouted until {@link SlimConnection.close} is called.
 */
export function createStdioConnection(options: StdioConnectionOptions = {}): SlimConnection {
  const usingRealStreams = options.input === undefined && options.output === undefined;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const tunnel = options.tunnel ?? process.stderr;

  // Capture the raw writers before any patching so protocol framing and tunnel
  // output cannot recurse through the patched methods. When writing to the real
  // process streams, always use the pristine writers captured at module load.
  const rawOutputWrite = (
    output === process.stdout ? writeToStdout : output.write.bind(output)
  ) as (chunk: string | Uint8Array) => boolean;
  const rawTunnelWrite = (
    tunnel === process.stderr ? writeToStderr : tunnel.write.bind(tunnel)
  ) as (chunk: string) => boolean;

  const reader = new FrameReader(input);
  const shouldRedirect = options.redirectProcessOutput ?? usingRealStreams;
  const restore = shouldRedirect
    ? installProcessOutputTunnel((text) => {
        rawTunnelWrite(text);
      })
    : undefined;

  return {
    writeHeader() {
      rawOutputWrite(SLIM_HEADER);
    },
    readMessage() {
      return reader.readMessage();
    },
    writeMessage(payload: string) {
      rawOutputWrite(encodeFrame(payload));
    },
    async close() {
      restore?.();
    },
  };
}
