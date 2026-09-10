# js-slim — a SLiM protocol harness for JavaScript / TypeScript

**Package:** `@killertux/js-slim` · **Runtime:** Node `>=20` · **Toolchain:** pnpm + tsc (dual ESM/CJS) + Vitest
**Status:** ready for review.

## Context

FitNesse drives acceptance tests via "SLiM" tables. It launches a *SLiM server* process and
speaks a small length-prefixed list protocol over a socket (or stdio). It sends lists of string
instructions (`import`, `make`, `call`, `callAndAssign`, `assign`); the server resolves fixture
classes, constructs fixtures, converts arguments, invokes methods, tracks symbols, and returns
`[id, value]` rows.

There is no mature typed Node implementation. Best prior art is
[`noamtcohen/SlimJS`](https://github.com/noamtcohen/SlimJS) (untyped, protocol-v0.3 era, low
adoption). The canonical reference is Java in `unclebob/fitnesse`:

- `src/fitnesse/slim/protocol/{SlimSerializer,SlimDeserializer}.java`
- `src/fitnesse/slim/{StatementExecutor,SlimExecutionContext,VariableStore,SlimSymbol}.java`
- `src/fitnesse/slim/instructions/*`, `src/fitnesse/slim/converters/*`
- `src/fitnesse/slim/{SlimService,SlimServer,SlimStreamReader,SlimPipeSocket}.java`
- Behavioral tests in `test/fitnesse/slim/**` — ported as our spec.

**Outcome:** a drop-in SLiM server FitNesse can launch, plus a fully typed fixture-authoring API
that works from both TypeScript and plain JavaScript.

## Confirmed decisions

1. **Scope:** full launchable server **and** typed library (codec, executor, converters, socket +
   stdio transports, fixture loader, CLI bin, public API).
2. **Fixture lookup:** `import` paths → modules, with an optional custom resolver hook.
3. **Type conversion:** smart runtime coercion by default + typed opt-out via decorators/metadata.
4. **Tests/CI:** Vitest unit + in-repo reference-client integration + real FitNesse e2e in GH Actions.
5. **Package:** `@killertux/js-slim`, Node `>=20`, pnpm, **tsc-only** dual build, Vitest.
6. **TS fixtures:** resolve `.ts` modules; `tsx` is an *optional* peer, precompilation also supported.

## Goals

- Correct SLiM protocol **v0.5** codec (list encoding, byte-length framing, version header, `bye`).
- Full transport: TCP socket + stdio (`port == 1`) with `SOUT`/`SERR` tunneling.
- Execute `import | make | call | callAndAssign | assign`.
- Symbol store with `$sym` substitution, symbol-as-object, fixture chaining, `assign`.
- Converter registry mirroring Java (String, Int, Long, Double, Boolean, Date, List, Map/hash, Void).
- Fixture resolution for JS/TS modules incl. namespaced class names and package specifiers.
- Library instances (`library*`), Slim helper library actors, System-Under-Test.
- Stop/Ignore semantics and standard error tags.
- First-class `.d.ts`; publish ESM + CJS; usable from plain JS.
- Zero runtime dependencies for the core.

## Non-goals (v1)

- `` $`expr` `` expression evaluation (`SlimExpressionEvaluator`) — deferred.
- SSL transport, `SLIM_AGENT_FIXTURE_HANDLES_SYMBOLS` escape hatch.
- FitNesse replacement; browser/edge runtimes.

## Protocol reference (behavior to match)

**Handshake / framing**
- Server writes raw header `Slim -- V0.5\n` (only un-prefixed message), then framed messages.
- Frame = `%06d` byte-length (min 6 digits, may grow) + `:` + UTF-8 payload.
- `bye` = `000003:bye` ends the session (case-insensitive).

**List codec** (`ListSerializer`/`ListDeserializer`)
- List → `[` + `<count>`(6+ digits + `:`) + per item `<len>:<chars>:` + `]`.
- `<len>` is **UTF-16 code units**; the frame length is **bytes** — never conflate them.
- Nested lists recurse; `null` → literal `null`; empty list → `[000000:]`.
- Deserializer rejects null/empty/missing `[`/missing `]`; an item starting with `[` is tentatively
  parsed as a nested list, else kept as a string. Non-string items serialize via `String(item)`.

**Instruction / response rows**
- Row `[id, op, ...]`; response `[id, value]`.
- `import` → path to **front** of search list (later imports win); returns `OK`.
- `make` → construct; instance name starting `library` becomes a library; single `$symbol` holding a
  non-string registers that object directly (symbol copy).
- `call` → instance method; fallback System-Under-Test, then libraries top-first.
- `callAndAssign` → call then store the result; `assign` → store raw value (protocol ≥ 0.4).
- `OK` for import/make/assign; `/__VOID__/` for void; `null` for null results.
- Errors → `__EXCEPTION__:` + tag (+ `message:<<...>>` pretty wrapper): `MALFORMED_INSTRUCTION`,
  `NO_CLASS`, `NO_INSTANCE`, `NO_CONSTRUCTOR`, `NO_METHOD_IN_CLASS`, `COULD_NOT_INVOKE_CONSTRUCTOR`,
  `NO_CONVERTER_FOR_ARGUMENT_NUMBER`, `TIMED_OUT`.
- Abort/ignore tags: `ABORT_SLIM_TEST`, `ABORT_SLIM_SUITE`, `IGNORE_SCRIPT_TEST`, `IGNORE_ALL_TESTS`;
  abort skips remaining statements in the batch.

**Stdio mode (port 1)**
- SUT stdout/stderr tunneled over real stderr: first line `SOUT.:`/`SERR.:`, continuations
  `SOUT :`/`SERR :` (matches `LoggingOutputStream`; the protocol page states the reverse).
  Node must capture `process.stdout.write` + `console.*` and re-emit to stderr.

## Architecture

```
transport (tcp | stdio) ─frames─▶ session ─decode─▶ instruction parse
                                        │
                    serialize ◀─ results ┴─▶ executor ─┬─▶ fixture loader
                                                        ├─▶ method resolver
                                                        └─▶ converter registry
```

Each connection gets a `Session` owning an `ExecutionContext` (instances, libraries, symbols,
paths). Module cache is process-global; instances/symbols are per-session.

## File layout

```
js-slim/
├─ package.json
├─ tsconfig.json / tsconfig.esm.json / tsconfig.cjs.json
├─ vitest.config.ts
├─ eslint.config.js / .prettierrc
├─ scripts/write-pkg-type.mjs          # writes dist/{esm,cjs}/package.json type stubs
├─ .github/workflows/ci.yml
├─ fitnesse/FitNesseRoot/**            # committed e2e wiki suite (templated)
├─ src/
│  ├─ index.ts                         # public API barrel
│  ├─ protocol/{serializer,deserializer,length,errors}.ts
│  ├─ transport/{frame,socket,stdio,client}.ts
│  ├─ instructions/{parse,types}.ts
│  ├─ runtime/{session,statement-executor,execution-context,variable-store,symbols,
│  │           method-resolver,fixture-loader,helper-library}.ts
│  ├─ converters/{registry,coerce,smart,string,number,bigint,boolean,date,list,map,object,void}.ts
│  ├─ errors.ts
│  ├─ server.ts
│  ├─ cli.ts
│  └─ fixture.ts                       # typed authoring API
├─ examples/                           # runnable fixtures, executed by the tests
└─ test/
   ├─ protocol/*.test.ts
   ├─ transport/*.test.ts
   ├─ runtime/*.test.ts
   ├─ converters/*.test.ts
   ├─ server.test.ts                   # SlimServer over a real socket
   ├─ cli.test.ts                      # argument parsing + CLI end to end
   ├─ fixtures/**.ts + **.js          # TS and plain-JS fixtures
   └─ e2e/fitnesse.test.ts
```

## Build & packaging (tsc-only dual output)

`package.json` essentials:

```jsonc
{
  "name": "@killertux/js-slim",
  "type": "module",
  "engines": { "node": ">=20" },
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/esm/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/esm/index.d.ts", "default": "./dist/esm/index.js" },
      "require": { "types": "./dist/cjs/index.d.ts", "default": "./dist/cjs/index.js" }
    },
    "./package.json": "./package.json"
  },
  "bin": { "js-slim": "./dist/esm/cli.js" },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "pnpm clean && pnpm build:esm && pnpm build:cjs",
    "build:esm": "tsc -p tsconfig.esm.json && node scripts/write-pkg-type.mjs esm module",
    "build:cjs": "tsc -p tsconfig.cjs.json && node scripts/write-pkg-type.mjs cjs commonjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "coverage": "vitest run --coverage",
    "lint": "eslint ."
  }
}
```

- Source uses **`.js` extensions on relative imports** (required by `NodeNext`); both builds emit
  correctly and the CJS build resolves them.
- `tsconfig.esm.json` → `module/moduleResolution: NodeNext`, `outDir: dist/esm`.
  `tsconfig.cjs.json` → `module: CommonJS`, `moduleResolution: Node`, `outDir: dist/cjs`.
- `scripts/write-pkg-type.mjs` writes `{"type":"module"}` / `{"type":"commonjs"}` stubs so Node
  interprets each folder correctly.
- `declaration`/`declarationMap`/`sourceMap` on → typed consumers get `.d.ts`.
- Vitest consumes `src/**` directly; if Vite needs help mapping `.js` specifiers to `.ts` source,
  add a `resolve.alias` from `.js` → source or a small plugin (noted as a known tsc-dual-build tweak).

## Module design

### `protocol/length.ts`, `serializer.ts`, `deserializer.ts`

```ts
export type SlimValue = string | SlimValue[];
export function serialize(list: SlimValue[]): string;
export function deserialize(serialized: string): SlimValue[];
export class SlimSyntaxError extends Error {}
```

Golden vectors from Java tests: `[] → [000000:]`, `["hello"] → [000001:000005:hello:]`,
two-item lists, nested lists, surrogate pairs, items containing `[`, non-string items, `null`.

### `transport/frame.ts`

```ts
export const PROTOCOL_VERSION = "0.5";
export const HEADER = `Slim -- V${PROTOCOL_VERSION}\n`;
export const BYE = "bye";
export function writeHeader(out: Writable): void;
export function writeFrame(out: Writable, payload: string): void;   // Buffer.byteLength
export class FrameReader { constructor(readable: Readable); readFrame(): Promise<string | null>; }
```

`FrameReader` buffers bytes, reads ≥6 digits up to `:`, validates the number, reads exactly N bytes,
decodes UTF-8, returns `null` on clean EOF. Tests cover multibyte UTF-8 and >6-digit lengths.

### `transport/socket.ts`, `stdio.ts`, `client.ts`

- `startSocketServer({ port, daemon, verbose, timeout, resolver, coercion })` → one `Session` per
  connection; non-daemon accepts one then closes; `daemon` keeps accepting (bounded concurrency).
- `startStdioServer(...)` → header to stdout, frames from stdin, redirect `process.stdout.write` +
  `console.*` into `SOUT`/`SERR` tunnel lines on stderr for the session, restore on `bye`/exit.
- `SlimClient` (reference FitNesse-side client): `connect`, `handshake`, `invoke(rows)`, `bye`.
  Used by integration/e2e tests; also a debugging aid.

### `instructions/parse.ts`, `types.ts`

```ts
export type Instruction =
  | { id: string; op: "import"; path: string }
  | { id: string; op: "make"; instance: string; className: string; args: SlimValue[] }
  | { id: string; op: "call"; instance: string; method: string; args: SlimValue[] }
  | { id: string; op: "callAndAssign"; symbol: string; instance: string; method: string; args: SlimValue[] }
  | { id: string; op: "assign"; symbol: string; value: SlimValue };

export function parseInstruction(row: SlimValue[]): Instruction; // → MALFORMED_INSTRUCTION carrying the row
```

### `runtime/variable-store.ts`, `symbols.ts`

- Port `SlimSymbol` regex `\$(([A-Za-z\p{L}][\w\p{L}]*)|`([^`]+)`)` and the prefix rule (`$v1`
  unknown → longest known prefix `$v`).
- `replaceSymbolsInString` skips `$x =` assignment syntax; `replaceSymbol(arg)`:
  - whole-arg `$name` whose stored value is non-string/list → return the object itself;
  - otherwise string substitution; unknown symbols left verbatim.
- Store keeps the raw object *and* its string form (Java `MethodExecutionResult`).

### `converters/registry.ts` + standard converters

```ts
export interface Converter<T> { toSlim(value: T): string | null; fromSlim(raw: string): T; }
export interface ConverterRegistry {
  register(type: SlimType, converter: Converter<unknown>): void;
  forType(type: SlimType | undefined): Converter<unknown> | undefined;
}
```

Standard set (exact Java error text preserved): `String`, `Number`/`Int`, `Long` (BigInt),
`Double`, `Boolean` (toSlim `true|false`; fromSlim `true|yes` case-insensitive), `Date`
(`dd-MMM-yyyy`, e.g. `05-May-2009`), `Array`/`SlimList` (`[a, b, c]` split+trim), `Map`/hash
(minimal zero-dep `<table><tr><td>…` Hash-Widget parser), `Void` → `/__VOID__/`.

### Smart coercion policy (default) + typed opt-out

Applied to `make` constructor args and `call`/`callAndAssign` args:

| Raw string | Default (`coercion: "smart"`) | Notes |
| --- | --- | --- |
| `"true"` / `"false"` (case-insensitive) | boolean | `"yes"`/`"no"` stay **strings** (matches Java `ShouldIBuyMilk`) |
| numeric literal (`/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/`, finite) | number | `"007"` → `7`, `"0.50"` → `0.5`; opt out with `String` |
| integer beyond `Number.MAX_SAFE_INTEGER` | string (lossless) | use `Long`/BigInt when typed |
| nested list | array (elements recursion only when typed) | `listOf(Number)` metadata coerces elements |
| anything else (incl. literal `"null"`) | string | literal `"null"` stays a string, Java parity |

- `coercion: "strict"` server option disables inference (args stay strings/arrays).
- Typed opt-out overrides inference per parameter: `@slimMethod({ params: [Number, String] })`,
  or JS `fixture({ methods: { add: { params: [Number, Number] } } })`.
- Typed conversion failure → `NO_CONVERTER_FOR_ARGUMENT_NUMBER` / converter error message.

### `runtime/fixture-loader.ts`

Resolution for `make` class `eg.Division` against imports (front-first):
1. Optional **custom resolver hook** `resolveFixture(spec) => Class | undefined`.
2. **Package specifier** (not starting `.`/`/`) → dynamic `import(spec)` then traverse dotted export path.
3. **Path import** `/dir` → try nested `dir/eg/Division.{js,mjs,cjs,ts}`, flattened
   `dir/eg.Division.{js,mjs,cjs,ts}`, or a module `dir/eg.js` exporting `Division`
   (also `default.eg.Division`),
   `dir/Division.js` → `mod.default`), plus `swapCaseOfFirstLetter` variants.
4. Exports may be class, constructor function, or factory (factory marked in metadata).
- `.ts` resolution works when a loader (`tsx`/`--import tsx`) or compiled JS is present; `tsx` stays
  an optional peer. Constructor errors → `COULD_NOT_INVOKE_CONSTRUCTOR`; not found → `NO_CLASS`.

### `runtime/method-resolver.ts`

- Candidate order: instance → System-Under-Test → libraries top-first.
- Name matching: exact, then `swapCaseOfFirstLetter` (Java parity), then a method whose declared
  metadata (`MethodMeta.name`) matches the requested name. Declared names are matched exactly;
  only real method names get the swap-case fallback.
- Arity from `fn.length` (rest args supported); miss returns a `noMethod` marker + sorted available
  method signatures for `NO_METHOD_IN_CLASS` diagnostics.
- SUT detection: property `sut` / `systemUnderTest`, or metadata `sut: "field"`.
- Promise-returning methods are `await`ed before serialization (async fixtures).

### `runtime/statement-executor.ts`, `execution-context.ts`, `session.ts`, `helper-library.ts`

- `ExecutionContext`: instances, libraries, variables, paths; `create`, `getInstance`, `addPath`,
  `setVariable`, `replaceSymbols`; library detection by `library` prefix.
- `StatementExecutor`: dispatch, conversion, stop/ignore flag, `reset()`.
- `Session`: framing loop (header → decode → execute → serialize); on `bye` stop; serialize thrown
  `SlimException` into the right tag; skip remaining statements after abort.
- `-s <seconds>`: race each instruction against a timer → `TIMED_OUT <n>`.
- Built-in `SlimHelperLibrary` at instance name `SlimHelperLibrary`: `getFixture`, `pushFixture`,
  `popFixture`, `cloneSymbol` (actors on `scriptTableActor`).

### `errors.ts`

`SlimError`, `SlimException` with `tag`, `prettyPrint`, `cause`; `toString()` yields the protocol
string and detects Stop/Ignore markers by class/name.

### `fixture.ts` — typed authoring API

```ts
// Constructors and collection names are both accepted; the string forms are
// aliases so metadata can be written as plain data.
export type ConverterKey =
  | typeof String | typeof Number | typeof BigInt | typeof Boolean | typeof Date
  | typeof Array | typeof Map | typeof Object
  | "list" | "map" | "object" | "void";
/** A list with a declared element type, e.g. `listOf(Number)` for `number[]`. */
export interface ListSlimType { readonly kind: "list"; readonly element: SlimType; }
export type SlimType = ConverterKey | ListSlimType;
export function listOf(element: SlimType): ListSlimType;

export interface MethodMeta { name?: string; params?: readonly SlimType[]; returns?: SlimType; }
export interface FixtureMeta {
  name?: string;
  methods?: Record<string, MethodMeta>;
  sut?: string;
  factory?: boolean;
}

export function slimFixture(meta?: FixtureMeta): SlimFixtureDecorator;
export function slimMethod(meta: MethodMeta): SlimMethodDecorator;
export function fixture(def: { class: C; name?: string; methods?: Record<string, MethodMeta>; sut?: string; factory?: boolean }): C;
export function defineFixture(ctor: FixtureExport, meta: FixtureMeta): void;
```

- **Standard (stage-3) decorators** — no `reflect-metadata`, no `experimentalDecorators`.
- Metadata is stored under `Symbol.for`-keyed properties (`FIXTURE_META` on the class or
  factory, `METHOD_META` on the method function) so the ESM and CJS builds share one key.
  `getFixtureMeta` also accepts an *instance* and reads its class's metadata.
- The metadata is **wired into the runtime**, not decorative:
  - `name` resolves the fixture (`FixtureLoader` accepts an export that declares it) and is
    used in `NO_METHOD_IN_CLASS` diagnostics.
  - `sut` names the System Under Test property, overriding the `sut`/`systemUnderTest` heuristic.
  - `factory: true` calls the export instead of `new`ing it.
  - `methods[].name` / `slimMethod({name})` declare the FitNesse-facing method name.
  - `params`/`returns` select converters for arguments and results instead of smart coercion.
- Metadata lives in `src/converters/slim-type.ts` (`ConverterKey`, `ListSlimType`, `SlimType`,
  `listOf`) and `src/fixture.ts`, which re-exports the types for authors who import them there.
- Readers (`getFixtureMeta`, `getOwnMethodMeta`, `getFixtureMethodMeta`, `getMethodMeta`,
  `methodWireName`, `declaredFixtureName`, `declaredSutName`, `isFactoryFixture`,
  `inheritFixtureMeta`) are the supported way for other runtime modules to consult metadata.
- JS users use `fixture(...)` / `defineFixture(...)` directly; there are runnable examples in
  `examples/` that the test suite executes.

### `cli.ts`

`js-slim [-v] [-s <seconds>] [-d] [-h] [port]`
- Port omitted / `1` → stdio; otherwise TCP listen. `-v` verbose; `-d` daemon (TCP only);
  `-s` per-instruction timeout.
- Exit codes mirror Java: `97` bad args, `98` startup exception, `99` OOM.
- `#!/usr/bin/env node` shebang preserved by `tsc`; `bin` → `dist/esm/cli.js`.

## Testing strategy (ported from Java)

| Suite | Source spec | Highlights |
| --- | --- | --- |
| `protocol/serializer.test.ts` | `SlimSerializerTest` | empty/one/two, nested, `null`, numeric, surrogate pairs, bracket items |
| `protocol/deserializer.test.ts` | `SlimDeserializerTest` | round-trips + all malformed rejections |
| `transport/frame.test.ts` | `SlimStreamReaderTest` | byte framing, >6-digit lengths, multibyte UTF-8, EOF |
| `converters/*.test.ts` | `converters/*Test` | per-type to/from + exact error strings |
| `runtime/variable-store.test.ts` | `SlimSymbol`/`VariableStore` | prefix symbols, symbol-as-object, null, assignments |
| `runtime/execution-context.test.ts` | `SlimExecutionContextTest`, `SlimInstanceCreationTestBase` | create, symbol class, library, paths |
| `runtime/method-resolver.test.ts` | `SlimMethodInvocationTestBase` | arity, conversion, void/null, lists/arrays, symbols |
| `runtime/statement-executor.test.ts` | `StatementExecutorTestBase`, `SlimGetSymbolTestBase` | SUT/library precedence, stop-test |
| `server/session.test.ts` | `ListExecutorTestBase`, `SlimServiceTestBase` | full batches over a real socket, 1000-call sequences, huge strings |
| `test/e2e/fitnesse.test.ts` | FitNesse acceptance | committed wiki suite run against the built CLI |

Test fixtures live in `test/fixtures/` in both `.ts` and `.js` to prove both authoring paths;
the TS ones also exercise the `tsx` loader.

## CI (`.github/workflows/ci.yml`)

Three jobs, all on `ubuntu-latest`:

- **quality** — matrix `node: [20.x, 22.x, 24.x]`: `pnpm install --frozen-lockfile`,
  `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm coverage`; the coverage
  artifact is uploaded from the 22.x leg. `build` runs **before** coverage because
  `test/cli-bin.test.ts` executes the built CLI and skips a stale build.
- **e2e** — Node 22 + Temurin JDK 17: `pnpm build`; download the **pinned**
  `fitnesse-standalone.jar` (`20241026`, cached under `.fitnesse/`); render
  `fitnesse/FitNesseRoot/**` with `scripts/render-fitnesse.mjs`; run `pnpm test:e2e`
  (`test/e2e/fitnesse.test.ts` driving `scripts/run-fitnesse.mjs`); upload the FitNesse
  `files/testResults` artifacts.
- **pack** — `pnpm pack`, `npm publish --dry-run`, then `scripts/verify-package.mjs`, which
  installs the tarball into a scratch project and checks the `exports` map, both `.d.ts` trees
  and the `js-slim` bin (including exit code 97).

### Writing the wiki pages

The committed pages are rendered (not copied) because FitNesse needs absolute paths:
`scripts/render-fitnesse.mjs` replaces the literal token `$PWD` with the repository root.

```
|import|
|$PWD/fitnesse/fixtures|
```

FitNesse's own conventions bit us twice, so they are worth stating:

- **FitNesse appends the SLiM port to `COMMAND_PATTERN` as the final argument.** The pattern must
  therefore *not* contain a port placeholder: `%p` is FitNesse's **classpath** placeholder (a Java
  convention) and is replaced with the literal string `defaultPath` when the classpath is empty.
  The suite uses `!define COMMAND_PATTERN {node $PWD/dist/esm/cli.js}` plus
  `!define SLIM_PORT {9123}`, and omits `SLIM_PORT` on the pipe-mode page where FitNesse appends
  `1` and the CLI switches to stdin/stdout. Keep the FitNesse web port clear of the SLiM range:
  FitNesse hands the *n*th TCP test page `SLIM_PORT + n`, so a web port of 9124 would collide with
  a second TCP page (the runner therefore defaults to 9200).
- **Script-table action rows alternate method and argument cells**, so `|add|4|5|` calls
  `add5(4)`. A call with more than one positional argument ends the method name with `;`:
  `|add;|4|5|`.
- **CamelCase fixture names are auto-linked as WikiWords**, which injects a "create page" anchor
  into the cell (and then into the class name). Escape them: `|script|!-TypedCalculator-!|`.

`scripts/run-fitnesse.mjs` decides pass/fail from the per-instruction `<status>` values in the
result XML — FitNesse's `<finalCounts>` there does not agree with the counts it prints — and also
requires the fixture's `console.log` marker to arrive through the output tunnel, so a run cannot
pass by silently corrupting the protocol stream.

## Steps

- [x] 1. Scaffold: `package.json`, tsconfigs, vitest, eslint, `write-pkg-type.mjs`, `.gitignore`, README stub.
- [x] 2. Protocol codec (`length`, `serializer`, `deserializer`, `SlimSyntaxError`) + golden tests.
- [x] 3. Framing + transports (`frame`, `socket`, `stdio`) + `client` + tests.
- [x] 4. Instruction parse/types + malformed handling + tests.
- [x] 5. Converter registry + standard converters + exact error text + smart-coercion tests.
- [x] 6. Variable store / `SlimSymbol` + tests.
- [x] 7. Fixture loader (path/package/dotted/resolver hook, `.ts` + `.js`) + fixtures.
- [x] 8. Method resolver (SUT, libraries, swap-case, async) + tests.
- [x] 9. Execution context + statement executor + helper library + stop/ignore + tests.
- [x] 10. Server session loop + error serialization + timeout + tests.
- [x] 11. CLI + bin + exit codes.
- [x] 12. Typed authoring API (`slimFixture`, `slimMethod`, `fixture`, `defineFixture`) + examples.
- [x] 13. GitHub Actions CI (quality matrix, e2e, pack).
- [ ] 14. README + docs: `COMMAND_PATTERN`, TS/JS fixture examples, conversion table, protocol notes.

## Verification

- `pnpm lint && pnpm typecheck && pnpm build && pnpm test` green; build emits ESM + CJS + `.d.ts`
  and `dist/{esm,cjs}/package.json` type stubs.
- Codec matches Java golden vectors incl. surrogate pairs and >6-digit lengths.
- `SlimClient` ↔ server over a real socket passes the ported ListExecutor/StatementExecutor scenarios.
- `node dist/esm/cli.js` from a JS fixture: manual script/decision table run.
- Real FitNesse: `COMMAND_PATTERN {node <abs>/dist/cli.js}` (FitNesse appends the SLiM port itself)
  runs the committed suite; automated in the CI `e2e` job.

## Risks / notes

- **UTF-16 vs byte length** mismatch is the classic porting bug — isolate in `length.ts`/`frame.ts`
  and test both explicitly.
- **tsc dual build**: relative imports need `.js`; Vitest may need a `.js`→`.ts` resolve alias —
  configured in step 1 if required.
- **TS fixtures at runtime**: document `COMMAND_PATTERN {node --import tsx <abs>/dist/cli.js}`
  (FitNesse appends the port) and the precompile path.
- **Stdio mode** must fully capture `console.*` + `process.stdout.write` or the protocol stream is
  corrupted; keep the redirect scoped and always restore.
- **Smart coercion** can surprise string fixtures (`"007"`); documented, configurable, and
  overridable with `String` params.
