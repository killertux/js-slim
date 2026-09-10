import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { SlimTransportError } from "../../src/transport/errors.js";
import {
  BYE_MESSAGE,
  FrameReader,
  PROTOCOL_VERSION,
  SLIM_HEADER,
  encodeFrame,
  isByeMessage,
} from "../../src/transport/frame.js";

function readerFromChunks(chunks: string[]): FrameReader {
  return new FrameReader(Readable.from(chunks.map((chunk) => Buffer.from(chunk, "utf8"))));
}

describe("encodeFrame", () => {
  it("prefixes the payload with its byte length", () => {
    expect(encodeFrame("bye").toString("utf8")).toBe("000003:bye");
  });

  it("counts bytes, not UTF-16 code units", () => {
    // "Köln" is 4 code units but 5 UTF-8 bytes; the frame length is bytes.
    expect("Köln".length).toBe(4);
    expect(encodeFrame("Köln").toString("utf8")).toBe("000005:Köln");
  });

  it("encodes an empty payload", () => {
    expect(encodeFrame("").toString("utf8")).toBe("000000:");
  });

  it("grows beyond six digits for large payloads", () => {
    const frame = encodeFrame("x".repeat(1_000_000));
    expect(frame.subarray(0, 8).toString("ascii")).toBe("1000000:");
  });
});

describe("header and bye", () => {
  it("exposes the protocol version and header", () => {
    expect(PROTOCOL_VERSION).toBe("0.5");
    expect(SLIM_HEADER).toBe("Slim -- V0.5\n");
  });

  it("recognises bye case-insensitively", () => {
    expect(BYE_MESSAGE).toBe("bye");
    expect(isByeMessage("bye")).toBe(true);
    expect(isByeMessage("BYE")).toBe(true);
    expect(isByeMessage("byebye")).toBe(false);
  });
});

describe("FrameReader", () => {
  it("reads a single frame and then reports EOF", async () => {
    const reader = readerFromChunks(["000003:bye"]);
    expect(await reader.readMessage()).toBe("bye");
    expect(await reader.readMessage()).toBeNull();
  });

  it("reassembles frames split across arbitrary chunk boundaries", async () => {
    const reader = readerFromChunks(["0000", "05:hel", "lo", "000005:world"]);
    expect(await reader.readMessage()).toBe("hello");
    expect(await reader.readMessage()).toBe("world");
    expect(await reader.readMessage()).toBeNull();
  });

  it("reads many frames packed into a single chunk", async () => {
    const reader = readerFromChunks(["000001:a000001:b000001:c"]);
    expect(await reader.readMessage()).toBe("a");
    expect(await reader.readMessage()).toBe("b");
    expect(await reader.readMessage()).toBe("c");
    expect(await reader.readMessage()).toBeNull();
  });

  it("rejects a frame larger than the configured maximum", async () => {
    const reader = new FrameReader(Readable.from([Buffer.from("000005:hello", "utf8")]), {
      maxFrameBytes: 3,
    });
    await expect(reader.readMessage()).rejects.toThrow(SlimTransportError);
  });

  it("reads multibyte UTF-8 payloads", async () => {
    const reader = readerFromChunks([encodeFrame("Köln").toString("utf8")]);
    expect(await reader.readMessage()).toBe("Köln");
  });

  it("reads large payloads", async () => {
    const payload = "x".repeat(1_000_000);
    const reader = readerFromChunks([encodeFrame(payload).toString("utf8")]);
    expect(await reader.readMessage()).toBe(payload);
  });

  it("reads an un-prefixed header line before framing", async () => {
    const reader = readerFromChunks([SLIM_HEADER, "000003:bye"]);
    expect(await reader.readLine()).toBe("Slim -- V0.5");
    expect(await reader.readMessage()).toBe("bye");
  });

  it("returns null on a clean EOF with no buffered bytes", async () => {
    expect(await readerFromChunks([]).readMessage()).toBeNull();
  });

  it("keeps reporting EOF after the stream has finished", async () => {
    const reader = readerFromChunks(["000003:bye"]);
    expect(await reader.readMessage()).toBe("bye");
    expect(await reader.readMessage()).toBeNull();
    expect(await reader.readMessage()).toBeNull();
  });

  it("returns a trailing line that has no newline", async () => {
    expect(await readerFromChunks(["partial"]).readLine()).toBe("partial");
  });

  it("throws on a truncated frame", async () => {
    await expect(readerFromChunks(["000005:hel"]).readMessage()).rejects.toThrow(
      SlimTransportError,
    );
  });

  it("throws on a non-numeric length prefix", async () => {
    await expect(readerFromChunks(["00000x:bye"]).readMessage()).rejects.toThrow(
      SlimTransportError,
    );
  });

  it("throws on a length prefix shorter than six digits", async () => {
    await expect(readerFromChunks(["003:bye"]).readMessage()).rejects.toThrow(SlimTransportError);
  });

  it("throws when a length prefix never terminates", async () => {
    await expect(readerFromChunks(["12345678901234567890"]).readMessage()).rejects.toThrow(
      SlimTransportError,
    );
  });
});
