import type { Readable, Writable } from "node:stream";
import { Writable as WritableStream } from "node:stream";

import { FrameReader, SLIM_HEADER, encodeFrame, type SlimConnection } from "./frame.js";

/** Which tunnel a line of fixture output belongs to. */
export type TunnelLevel = "SOUT" | "SERR";

/** Receives already-prefixed tunnel output. */
export type TunnelSink = (text: string) => void;

/** Prefix for the first line of a record. */
const FIRST_LINE_PREFIX = ".:";

/** Prefix for the continuation lines of a record. */
const FOLLOWING_LINE_PREFIX = " :";

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
  const stdoutTunnel = createOutputTunnel(sink, "SOUT");
  const stderrTunnel = createOutputTunnel(sink, "SERR");
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

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

  return () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  };
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
  // output cannot recurse through the patched methods.
  const rawOutputWrite = output.write.bind(output) as (chunk: string | Uint8Array) => boolean;
  const rawTunnelWrite = tunnel.write.bind(tunnel) as (chunk: string) => boolean;

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
