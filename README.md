# @killertux/js-slim

[![CI](https://github.com/killertux/js-slim/actions/workflows/ci.yml/badge.svg)](https://github.com/killertux/js-slim/actions/workflows/ci.yml)

A typed [SLiM](https://fitnesse.org/FitNesse.UserGuide.WritingAcceptanceTests.SliM) protocol
harness/server for [FitNesse](https://fitnesse.org/), for Node.js — usable from both TypeScript and
plain JavaScript.

FitNesse drives acceptance tests by launching a _SLiM server_ and speaking a small length-prefixed
list protocol with it. `@killertux/js-slim` is that server for the Node.js ecosystem: it resolves
fixture classes from JS/TS modules, converts arguments, invokes methods, tracks symbols, and returns
results — so you can write FitNesse fixtures with the full JavaScript ecosystem.

- **Zero runtime dependencies.** The core is plain ES2022 plus Node built-ins.
- **Dual build.** ESM + CJS with type declarations (`exports` map, no `require` of ESM).
- **Typed fixtures.** Declare parameter and return types (including list element types) so values
  convert exactly instead of being guessed.
- **Runs the real thing.** CI launches a pinned FitNesse against the built CLI over **both** TCP and
  stdin/stdout pipe mode.

## Requirements

|                 | Version                              |
| --------------- | ------------------------------------ |
| **Runtime**     | Node.js `>= 22`                      |
| **Development** | Node.js `>= 22.13` and pnpm `11.5.2` |

The development floor is higher than the runtime floor because pnpm 11 requires Node 22.13 or newer
(it uses `node:sqlite`, which Node 20 lacks). `package.json` records the runtime floor in `engines`,
the toolchain floor in `devEngines.runtime`, and pins pnpm itself through `packageManager`. Node 20
is not supported: it is end-of-life, and the toolchain cannot run there.

## Install

```sh
npm install --save-dev @killertux/js-slim
```

## Quick start

**1. Write a fixture.** A plain JavaScript class is already a valid fixture — no imports, no
metadata, no build step:

```js
// fixtures/Calculator.js
export class Calculator {
  #total = 0;

  reset() {
    this.#total = 0;
  }

  add(...values) {
    this.#total += values.reduce((sum, value) => sum + Number(value), 0);
    return this.#total;
  }

  total() {
    return this.#total;
  }
}
```

**2. Point FitNesse at the CLI.** In a wiki page (see
[docs/fitnesse-setup.md](./docs/fitnesse-setup.md) for the full guide):

```text
!define TEST_SYSTEM {slim}
!define COMMAND_PATTERN {node /absolute/path/to/node_modules/@killertux/js-slim/dist/esm/cli.js}
!define SLIM_PORT {9123}

|import|
|/absolute/path/to/fixtures|

|script|Calculator|
|add;|2|3|
|check|total|5|
```

**3. Run the page.** FitNesse appends the SLiM port to `COMMAND_PATTERN` itself, so the pattern must
not contain a port placeholder. Omit `SLIM_PORT` entirely to use stdin/stdout pipe mode instead of
TCP.

> **Two FitNesse syntax traps** that cost us real debugging time, both explained in
> [docs/fitnesse-setup.md](./docs/fitnesse-setup.md): script-table action rows alternate
> method/argument cells (so multi-argument calls need `|add;|2|3|`), and CamelCase fixture names are
> auto-linked as WikiWords (escape them as `!-MyFixture-!`).

## Command line

```text
js-slim [-v] [-s <seconds>] [-d] [-h] [port]
```

| Flag              | Meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `port`            | TCP port to listen on. Omit (or pass `1`) for stdin/stdout pipe mode |
| `-v`, `--verbose` | Log every instruction and result to stderr                           |
| `-s`, `--timeout` | Per-instruction timeout in seconds (decimals allowed)                |
| `-d`, `--daemon`  | Keep listening after the first connection (TCP mode only)            |
| `-h`, `--help`    | Show usage and exit                                                  |

Exit codes mirror Java's `SlimService`: `0` success, `97` bad arguments, `98` startup failure,
`99` out of memory. Java's `-i` (interaction class) and `-ssl` options are not supported.

## Typed fixtures

JavaScript metadata is declared with `fixture`; TypeScript can use decorators. Both attach the same
metadata, stored under `Symbol.for` keys so the ESM and CJS builds agree.

```ts
// TypeScript
import { listOf, slimFixture, slimMethod } from "@killertux/js-slim";

@slimFixture({ name: "TypedCalculator", sut: "calculator" })
export class TypedCalculatorFixture {
  readonly calculator = new Calculator();

  @slimMethod({ params: [Number], returns: Number })
  add(value: number): number {
    return this.calculator.add(value);
  }

  /** `"sum of"` is not a valid JavaScript identifier, so declare the alias. */
  @slimMethod({ name: "sum of", params: [listOf(Number)], returns: Number })
  sumOf(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }
}
```

```js
// JavaScript
import { fixture, listOf } from "@killertux/js-slim";

class Counter {
  #count = 0;
  increment(by) {
    this.#count += Number(by);
    return this.#count;
  }
}

export default fixture({
  class: Counter,
  name: "Counter",
  methods: { increment: { params: [Number], returns: Number } },
});
```

### What the metadata does

| Field                             | Effect                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `FixtureMeta.name`                | The fixture's FitNesse name: used to resolve it (see below) and in `NO_METHOD_IN_CLASS` diagnostics  |
| `FixtureMeta.sut`                 | Names the property holding the System Under Test, overriding the `sut` / `systemUnderTest` heuristic |
| `FixtureMeta.factory`             | `true` calls the export instead of `new`ing it, so a closure can build the fixture                   |
| `FixtureMeta.methods[js].name`    | The wire name FitNesse uses for that method                                                          |
| `FixtureMeta.methods[js].params`  | Declared parameter types, in order — converted exactly instead of smart-coerced                      |
| `FixtureMeta.methods[js].returns` | Declared return type, rendered through its converter                                                 |

`MethodMeta` is a _value_, so a TypeScript type like `Array<Number>` cannot appear in it. Element
types use a value-level helper: `listOf(Number)` converts `|1,2,3|` into `[1, 2, 3]`, whereas a
bare `Array` (or `"list"`) yields the raw SLiM strings `["1", "2", "3"]`.

Resolution note: the loader matches a fixture by the file name derived from the requested class
name, _and_ by an export whose declared `name` matches, so a file named after the fixture works
either way. Declared names do not apply to package-specifier import roots.

## Types and conversion

FitNesse sends every cell as a string (or a list of strings). By default arguments are **smart
coerced**; declaring a type selects an exact converter instead.

```ts
import { coerceValue, listOf, toSlimValue } from "@killertux/js-slim";

coerceValue("42"); // 42            (number)
coerceValue("yes"); // "yes"        (string — only true/false are booleans)
coerceValue("42", String); // "42"  (declared type wins)
coerceValue("1,2,3", listOf(Number)); // [1, 2, 3]
toSlimValue(5); // "5"
toSlimValue(undefined); // "/__VOID__/"
```

| Input                                          | Default (smart coercion)  | Declared type                  |
| ---------------------------------------------- | ------------------------- | ------------------------------ |
| `true` / `false` (any case)                    | boolean                   | `Boolean` accepts `true`/`yes` |
| `yes` / `no`                                   | stays a string            | —                              |
| numeric literal (`42`, `-0.5`, `1e3`)          | number                    | `Number` (also trims spaces)   |
| integer beyond `Number.MAX_SAFE_INTEGER`       | stays a string (lossless) | `BigInt`                       |
| literal that underflows to `0` (e.g. `1e-400`) | stays a string            | `Number`                       |
| `a, b`                                         | stays a string            | `Array` → `["a", "b"]`         |
| `[a, b]` (already decoded)                     | list of raw strings       | `listOf(T)` converts elements  |
| `"null"`, empty string                         | stays a string            | `"void"` → `null`              |
| anything else                                  | stays a string            | `Object` → smart-coerced again |

Dates use FitNesse's `dd-MMM-yyyy` format (e.g. `05-May-2009`) interpreted in **UTC**, so results do
not depend on the host time zone. Hash tables use FitNesse's HTML table format. `void` methods
return `/__VOID__/`, matching Java's `VoidConverter`.

## Symbols and the System Under Test

`callAndAssign` stores a result as a `$symbol`; `$name` elsewhere in a batch is substituted before
conversion. Symbols can hold objects, not just text: a symbol holding the number `5` fills a
`Number` parameter directly, and a number filling a declared `String` parameter is stringified.

If a fixture has a `sut` (or `systemUnderTest`) property — or declares one — method calls resolve
against the fixture first and then its SUT, so a fixture can expose a plain service without writing
delegating methods.

## Documentation

- [docs/fitnesse-setup.md](./docs/fitnesse-setup.md) — wiring FitNesse: `COMMAND_PATTERN`, pipe vs
  TCP, script/decision tables, and the syntax traps.
- [docs/protocol-notes.md](./docs/protocol-notes.md) — the wire protocol, error format, timeouts,
  the pipe-mode output tunnel, and the differences from Java's FitNesse.

## Library API

The package exports the protocol codec, transports and the full runtime, so a SLiM server can be
embedded in a larger tool rather than run as a CLI:

```ts
import { FixtureLoader, SlimClient, SlimServer, startSocketServer } from "@killertux/js-slim";

const server = new SlimServer({ fixtureLoader: new FixtureLoader() });
const running = await startSocketServer({
  port: 0,
  handleConnection: (connection) => server.serve(connection),
});

const client = await SlimClient.connect({ port: running.port });
const rows = await client.invoke([
  ["m1", "make", "calc", "Calculator"],
  ["c1", "call", "calc", "add", "2", "3"],
]);
await client.bye();
await client.close();
await running.close();
```

Beyond the entry points above: `parseInstruction` / instruction types, `serialize` / `deserialize` /
`encodeLength`, `FrameReader` / `encodeFrame`, the stdio helpers (`createStdioConnection`,
`installProcessOutputTunnel`), `StatementExecutor` / `ExecutionContext` / `VariableStore` /
`MethodResolver` / `FixtureLoader`, the converter registry, and the fixture authoring API
(`slimFixture`, `slimMethod`, `fixture`, `defineFixture`, `listOf`). Every export is listed in
[`src/index.ts`](./src/index.ts).

## Differences from Java FitNesse

Deliberate divergences, all covered by tests:

- **Arity preference.** An exact-arity match anywhere in the receiver chain wins before a relaxed
  (`fn.length < arity`) match, so a lower-arity fixture method cannot shadow a correctly-arity SUT
  method. Java matches the exact parameter count only.
- **Relaxed arity is allowed at all.** JavaScript ignores extra arguments, so a method declaring
  fewer parameters than the call still matches.
- **`undefined` is not `null`.** A method returning `undefined` yields `/__VOID__/`; an explicit
  `null` yields FitNesse's null.
- **Dates are UTC**, not host-local.
- **Malformed rows do not kill the connection.** A structurally invalid instruction becomes an
  exception row for that id and the batch continues (Java aborts the session).
- **`Timeout` cannot cancel work.** A timed-out instruction keeps running in the background (there is
  no cancellation in JavaScript) and may still mutate session state, matching what a Java
  `Future` timeout looks like from the outside.
- **Backtick expressions are left literal.** Java's `SlimExpressionEvaluator` is not implemented.
- **Package-specifier import roots** (e.g. `|import|my-fixtures|`) resolve by export path; declared
  fixture names apply to filesystem roots only.

## Development

```sh
pnpm install          # Node >= 22.13
pnpm format:check     # prettier
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit
pnpm build            # dual ESM + CJS build into dist/
pnpm test             # vitest
pnpm coverage         # vitest with v8 coverage
```

### The FitNesse acceptance suite

`fitnesse/FitNesseRoot` is a committed wiki suite that CI runs against the built CLI over both
transports; `fitnesse/fixtures` holds the fixtures it uses.

```sh
pnpm build
FITNESSE_JAR=/path/to/fitnesse-standalone.jar pnpm test:e2e   # needs a JDK 11+
```

`scripts/run-fitnesse.mjs` renders the wiki templates (replacing `$PWD` with the checkout path),
runs FitNesse, and fails unless every expected page ran with no failures, no exceptions, no ignored
assertions, and the fixture's console output arrived through the pipe-mode tunnel. The runner is
also usable directly: `FITNESSE_JAR=… pnpm e2e`.

### Packaging

```sh
pnpm build
node scripts/verify-package.mjs   # installs the packed tarball and checks exports, types and the bin
```

## License

MIT
