/**
 * `@killertux/js-slim` — a typed SLiM protocol harness for FitNesse.
 *
 * This is the public entry point.
 */

/** The package version, kept in sync with `package.json`. */
export const VERSION = "0.1.0";

// Errors

export {
  ABORT_SLIM_SUITE_TAG,
  ABORT_SLIM_TEST_TAG,
  EXCEPTION_TAG,
  IGNORE_ALL_TESTS_TAG,
  IGNORE_SCRIPT_TEST_TAG,
  IgnoreAllTestsError,
  IgnoreScriptTestError,
  PRETTY_PRINT_END,
  PRETTY_PRINT_START,
  SLIM_ERROR,
  SlimError,
  StopSuiteError,
  StopTestError,
  formatException,
  formatSlimMessage,
  isIgnoreAllTestsError,
  isIgnoreScriptTestError,
  isStopOrIgnoreError,
  isStopSuiteError,
  isStopTestError,
} from "./errors.js";
export type { SlimErrorOptions, SlimErrorTag } from "./errors.js";

// Protocol codec
export { SlimSyntaxError } from "./protocol/errors.js";
export { MAX_NESTING_DEPTH, deserialize } from "./protocol/deserializer.js";
export { encodeLength, MINIMUM_NUMBER_LENGTH } from "./protocol/length.js";
export { serialize } from "./protocol/serializer.js";
export type { SlimList, SlimSerializable, SlimValue } from "./protocol/types.js";

// Instructions

export { parseInstruction } from "./instructions/parse.js";
export type {
  AssignInstruction,
  CallAndAssignInstruction,
  CallInstruction,
  ImportInstruction,
  InvalidInstruction,
  MakeInstruction,
  SlimInstruction,
} from "./instructions/types.js";

// Converters

export {
  BigIntConverter,
  BooleanConverter,
  ConverterRegistry,
  DateConverter,
  ListConverter,
  MapConverter,
  NumberConverter,
  ObjectConverter,
  StringConverter,
  VOID_TAG,
  VoidConverter,
  coerceArgument,
  coerceValue,
  defaultConverterRegistry,
  formatDate,
  formatHashTable,
  getConverter,
  parseDate,
  parseHashTable,
  parseListString,
  slimValueToString,
  smartCoerce,
  toSlimValue,
} from "./converters/index.js";
export type { Converter, SlimType } from "./converters/types.js";

// Runtime

export {
  SYMBOL_ASSIGNMENT_PATTERN,
  SYMBOL_PATTERN,
  isSymbolAssignment,
  substituteSymbols,
} from "./runtime/symbols.js";
export type { SymbolResolver } from "./runtime/symbols.js";
export { VariableStore } from "./runtime/variable-store.js";
export type { StoredSymbol } from "./runtime/variable-store.js";
export { FixtureLoader, swapCaseOfFirstLetter } from "./runtime/fixture-loader.js";
export type {
  FixtureConstructor,
  FixtureImporter,
  FixtureLoaderOptions,
  FixtureResolver,
} from "./runtime/fixture-loader.js";
export {
  DEFAULT_SUT_NAMES,
  MethodResolver,
  describeMethods,
  findMethodOn,
  findSystemUnderTest,
  invokeMethod,
  listMethods,
} from "./runtime/method-resolver.js";
export type {
  FixtureMethod,
  MethodInfo,
  MethodMatch,
  MethodResolverOptions,
} from "./runtime/method-resolver.js";
export { ExecutionContext } from "./runtime/execution-context.js";
export type { ExecutionContextOptions, Library } from "./runtime/execution-context.js";
export {
  SCRIPT_TABLE_ACTOR,
  SLIM_HELPER_LIBRARY_NAME,
  SlimHelperLibrary,
} from "./runtime/helper-library.js";
export type { ActorHost } from "./runtime/helper-library.js";
export { StatementExecutor } from "./runtime/statement-executor.js";
export type { SlimRow, StatementExecutorOptions } from "./runtime/statement-executor.js";

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
