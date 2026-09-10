/**
 * `@killertux/js-slim` — a typed SLiM protocol harness for FitNesse.
 *
 * This is the public entry point.
 */

/** The package version, kept in sync with `package.json`. */
export const VERSION = "0.1.0";

// Protocol codec
export { SlimSyntaxError } from "./protocol/errors.js";
export { MAX_NESTING_DEPTH, deserialize } from "./protocol/deserializer.js";
export { encodeLength, MINIMUM_NUMBER_LENGTH } from "./protocol/length.js";
export { serialize } from "./protocol/serializer.js";
export type { SlimList, SlimSerializable, SlimValue } from "./protocol/types.js";

// Transport
export { SlimClient, toResultMap } from "./transport/client.js";
export type { SlimClientOptions } from "./transport/client.js";
export { SlimTransportError } from "./transport/errors.js";
export {
  BYE_MESSAGE,
  FrameReader,
  isByeMessage,
  PROTOCOL_VERSION,
  SLIM_HEADER,
  encodeFrame,
  writeFrame,
  writeHeader,
} from "./transport/frame.js";
export type { SlimConnection } from "./transport/frame.js";
export { createSocketConnection, startSocketServer } from "./transport/socket.js";
export type { RunningSocketServer, SocketServerOptions } from "./transport/socket.js";
export {
  createOutputTunnel,
  createStdioConnection,
  formatTunneledChunk,
  installProcessOutputTunnel,
} from "./transport/stdio.js";
export type { StdioConnectionOptions, TunnelLevel, TunnelSink } from "./transport/stdio.js";
