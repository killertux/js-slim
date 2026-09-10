import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { SlimTransportError } from "../../src/transport/errors.js";
import { SLIM_HEADER, encodeFrame } from "../../src/transport/frame.js";
import {
  createOutputTunnel,
  createStdioConnection,
  formatTunneledChunk,
  installProcessOutputTunnel,
} from "../../src/transport/stdio.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("formatTunneledChunk", () => {
  it("prefixes the first line with '.:' and continuations with ' :'", () => {
    expect(formatTunneledChunk("Hello World\n", "SOUT")).toBe("SOUT.:Hello World\n");
    expect(formatTunneledChunk("a\nb\nc\n", "SOUT")).toBe("SOUT.:a\nSOUT :b\nSOUT :c\n");
    expect(formatTunneledChunk("oops\n", "SERR")).toBe("SERR.:oops\n");
  });

  it("matches the Java multi-line vector including blank lines", () => {
    expect(formatTunneledChunk("Hello World\n\nBye\n", "SOUT")).toBe(
      "SOUT.:Hello World\nSOUT :\nSOUT :Bye\n",
    );
  });

  it("skips empty records", () => {
    expect(formatTunneledChunk("", "SOUT")).toBe("");
    expect(formatTunneledChunk("\n", "SOUT")).toBe("");
    expect(formatTunneledChunk("\r\n", "SOUT")).toBe("");
  });

  it("keeps text that has no trailing newline", () => {
    expect(formatTunneledChunk("partial", "SOUT")).toBe("SOUT.:partial\n");
  });
});

describe("createOutputTunnel", () => {
  it("forwards formatted text to the sink", async () => {
    const chunks: string[] = [];
    const tunnel = createOutputTunnel((text) => chunks.push(text), "SOUT");

    tunnel.write("hello\n");
    tunnel.write("world\n");
    await flush();

    expect(chunks).toEqual(["SOUT.:hello\n", "SOUT.:world\n"]);
  });

  it("decodes Buffer chunks as UTF-8", async () => {
    const chunks: string[] = [];
    const tunnel = createOutputTunnel((text) => chunks.push(text), "SERR");

    tunnel.write(Buffer.from("Köln\n", "utf8"));
    await flush();

    expect(chunks).toEqual(["SERR.:Köln\n"]);
  });
});

describe("createStdioConnection", () => {
  it("reads framed messages from input and writes framed responses to output", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const tunnel = new PassThrough();

    let written = "";
    output.on("data", (chunk: Buffer) => {
      written += chunk.toString("utf8");
    });

    const connection = createStdioConnection({ input, output, tunnel });

    connection.writeHeader();
    expect(written).toBe(SLIM_HEADER);

    input.write(encodeFrame("hello"));
    expect(await connection.readMessage()).toBe("hello");

    connection.writeMessage("world");
    expect(written).toBe(`${SLIM_HEADER}000005:world`);

    await connection.close();
  });

  it("does not touch the process output streams when streams are injected", async () => {
    const originalStdoutWrite = process.stdout.write;
    const connection = createStdioConnection({
      input: new PassThrough(),
      output: new PassThrough(),
      tunnel: new PassThrough(),
    });

    expect(process.stdout.write).toBe(originalStdoutWrite);
    await connection.close();
  });

  it("restores process output when redirection is enabled", async () => {
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    const connection = createStdioConnection({
      input: new PassThrough(),
      output: new PassThrough(),
      tunnel: new PassThrough(),
      redirectProcessOutput: true,
    });

    try {
      expect(process.stdout.write).not.toBe(originalStdoutWrite);
    } finally {
      await connection.close();
    }

    expect(process.stdout.write).toBe(originalStdoutWrite);
    expect(process.stderr.write).toBe(originalStderrWrite);
  });
});

describe("installProcessOutputTunnel", () => {
  it("refuses a second tunnel and allows a fresh one after restore", () => {
    const restore = installProcessOutputTunnel(() => {});
    try {
      expect(() => installProcessOutputTunnel(() => {})).toThrow(SlimTransportError);
    } finally {
      restore();
    }

    const restoreAgain = installProcessOutputTunnel(() => {});
    restoreAgain();
  });

  it("routes process output through the sink and restores the writers", async () => {
    const tunnel = new PassThrough();
    let captured = "";
    tunnel.on("data", (chunk: Buffer) => {
      captured += chunk.toString("utf8");
    });

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    const restore = installProcessOutputTunnel((text) => {
      tunnel.write(text);
    });

    try {
      process.stdout.write("out\n");
      process.stdout.write(Buffer.from("buf\n"), "utf8");
      process.stdout.write("cb\n", () => {});
      process.stdout.write("full\n", "utf8", () => {});
      process.stderr.write("err\n");
    } finally {
      restore();
    }

    await flush();

    expect(captured).toContain("SOUT.:out\n");
    expect(captured).toContain("SOUT.:buf\n");
    expect(captured).toContain("SOUT.:cb\n");
    expect(captured).toContain("SOUT.:full\n");
    expect(captured).toContain("SERR.:err\n");
    expect(process.stdout.write).toBe(originalStdoutWrite);
    expect(process.stderr.write).toBe(originalStderrWrite);
  });
});
