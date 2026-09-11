# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-11

The first release: a complete SLiM server for FitNesse, plus the library it is built from.

### Added

- **Protocol codec** — SLiM list serialization/deserialization (`serialize`, `deserialize`,
  `encodeLength`), with UTF-16 code-unit inner lengths, a 500-level nesting limit, and
  `SlimSyntaxError` on malformed input.
- **Transports** — byte-framed messages (`FrameReader`, `encodeFrame`), a TCP server
  (`startSocketServer`), stdin/stdout pipe mode (`createStdioConnection`) including the
  `SOUT.:`/`SERR.:` output tunnel, and a FitNesse-side client (`SlimClient`).
- **Runtime** — instruction parsing (`parseInstruction`), fixture loading from JS/TS modules
  (`FixtureLoader`, with file/stem/dotted/declared-name resolution and swap-case fallback), method
  resolution over fixture → System Under Test → libraries (`MethodResolver`), symbol handling
  (`VariableStore`), the `StatementExecutor` with the stop/ignore protocol, and the built-in
  `SlimHelperLibrary` actor stack.
- **Server** — `SlimServer` plus the per-connection session loop (header, framed batches, `bye`),
  per-instruction timeouts (`TIMED_OUT`), and error serialization that preserves stop/ignore tags.
- **CLI** — `js-slim [-v] [-s <seconds>] [-d] [-h] [port]` with Java-parity exit codes
  (`97` bad arguments, `98` startup failure, `99` out of memory).
- **Typed authoring API** — `slimFixture`/`slimMethod` decorators and the JS `fixture`/`defineFixture`
  helpers, with `FixtureMeta`/`MethodMeta` metadata (fixture name, SUT property, factory exports,
  method aliases, declared parameter and return types) stored under `Symbol.for` keys so the ESM and
  CJS builds agree. Element types via `listOf(Number)`.
- **Converters** — a registry with `String`, `Number`, `BigInt`, `Boolean`, `Date` (UTC,
  `dd-MMM-yyyy`), `Array`, `Map`, `Object` and `void`, smart coercion for undeclared arguments, and
  `coerceValue` / `coerceArgument` / `toSlimValue`.
- **Documentation** — a README with the conversion table and the deliberate divergences from Java
  FitNesse, `docs/fitnesse-setup.md` (FitNesse wiring and its syntax traps) and
  `docs/protocol-notes.md` (wire format, errors, tunnel).
- **Tests and CI** — 500+ unit tests, a committed FitNesse acceptance suite run in CI over both TCP
  and pipe mode, a packaging verification script, and a Node 22/24 quality matrix.

### Notes

- Node.js `>= 22` is required at runtime; development needs `>= 22.13` because pnpm 11 uses
  `node:sqlite`.
- Zero runtime dependencies. The core needs only Node built-ins.

[0.1.0]: https://github.com/killertux/js-slim/releases/tag/v0.1.0
