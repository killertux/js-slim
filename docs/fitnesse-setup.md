# Wiring FitNesse to js-slim

Everything on this page is load-bearing: FitNesse's own conventions are what we got wrong first, so
they are written down with the symptom each one produces.

## A minimal page

```text
!define TEST_SYSTEM {slim}
!define COMMAND_PATTERN {node /abs/path/node_modules/@killertux/js-slim/dist/esm/cli.js}
!define SLIM_PORT {9123}

|import|
|/abs/path/to/fixtures|

|script|Calculator|
|add;|2|3|
|check|total|5|
```

## `COMMAND_PATTERN` must not contain a port placeholder

FitNesse **appends the SLiM port as the final argument**, so the command it actually runs is
`node …/cli.js 9123`. There is no port placeholder to write.

`%p` looks like one, but it is FitNesse's **classpath** placeholder (a Java convention): with an
empty classpath it expands to the literal string `defaultPath`, and the CLI then exits `97`:

```text
command:  node /abs/path/dist/esm/cli.js defaultPath 9123
stdErr:   Unexpected argument: 9123
exitCode: 97
```

Likewise `%m` is the test-runner class name, not a module path.

## Pipe mode and TCP mode

| Page setting               | FitNesse appends | CLI behaviour                                   |
| -------------------------- | ---------------- | ----------------------------------------------- |
| `!define SLIM_PORT {9123}` | `9123`           | Listens on that TCP port, serves one connection |
| _(nothing)_                | `1`              | stdin/stdout pipe mode (FitNesse's default)     |

Both are supported and both are exercised by the committed acceptance suite. Pipe mode is the better
default for a test runner because it needs no free port; TCP mode is easier to attach a debugger to.
Add `-d` to the command pattern to keep the server listening for several connections.

If you pin `SLIM_PORT`, keep FitNesse's own web port clear of the SLiM range: FitNesse hands the
*n*th TCP test page `SLIM_PORT + n`, so a web port of `9124` collides with a second TCP page. The
bundled runner uses web port 9200.

## Script-table rows alternate cells

A script-table **action** row reads alternating _method_ and _argument_ cells, so this calls
`add5(4)` — not `add(4, 5)`:

```text
|script|Calculator|
|add|4|5|          ← method "add5", one argument: 4
|check|total|9|
```

End the method name with `;` to switch the row to positional arguments:

```text
|script|Calculator|
|add;|4|5|         ← method "add", arguments: 4, 5
|check|total|9|
```

`check`, `reject`, `ensure` and `$symbol=` rows take their arguments positionally already, so
`|check|total|9|` and `|$sum=|add;|7|8|` are correct as written. FitNesse never sends the `;` over
the wire — it is table syntax only.

## CamelCase fixture names are WikiWords

FitNesse auto-links CamelCase words, and an undefined one gets a "create page" link injected into
the cell — which lands **inside the class name**:

```text
Could not invoke constructor for TypedCalculator<a title="create page" href="….TypedCalculator?edit">[?]</a>
```

Escape the name with `!-…-!`:

```text
|script|!-TypedCalculator-!|
```

A single-capital word such as `Calculator` is not a WikiWord and needs no escape.

## Table styles

```text
|script|Calculator|                 ← script table
|add;|2|3|
|check|total|5|

|Calculator|                        ← decision table (setters + a `?` output column)
|a|b|sum?|
|1|2|3|

|query:Employees|                   ← query table
|name|age|
|Ada|36|
```

A decision table calls `setA`/`setB` for the input columns and `sum()` for the `sum?` output column.

A query table calls the fixture's `query()` method — an ordinary SLiM `call`, so nothing special is
needed on this side. It returns one entry per result row, and each row is a list of `[field, value]`
pairs:

```js
query() {
  return [
    [["name", "Ada"], ["age", "36"]],
    [["name", "Grace"], ["age", "45"]],
  ];
}
```

The header cells name which fields to compare (in any order), and rows are matched regardless of the
order the fixture returns them in.

> The nesting matters. Each row element must be a two-item `[field, value]` list; a flat row such as
> `["name", "Ada", "age", "36"]` makes FitNesse abort the entire run with
> `ClassCastException: class java.lang.String cannot be cast to class java.util.List`, and the page's
> results are reported as incomplete.

## Fixtures the CLI can load

`|import|` adds a search root — a directory, a module file, or a package specifier — and later
imports take precedence. Within a root, a fixture is found by:

- the file derived from the requested name (`Calculator` → `<root>/Calculator.js`), using a default
  export or a named export of the same name;
- a dotted name (`eg.Division` → `<root>/eg/Division.js`, `<root>/eg.Division.js`, or
  `<root>/eg.js` exporting `Division`);
- an export whose declared fixture `name` matches (`fixture({ name: "MyAlias" })` in
  `<root>/MyAlias.js`);
- `swapCaseOfFirstLetter` as a fallback (`myFixture` finds `MyFixture`).

Extensions tried in order: `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`. TypeScript fixtures need a
loader, e.g. `COMMAND_PATTERN {node --import tsx /abs/path/dist/esm/cli.js}`, or precompilation.

## Running the committed suite locally

```sh
pnpm build
FITNESSE_JAR=/path/to/fitnesse-standalone.jar pnpm test:e2e
```

Needs a JDK 11+ (the pinned FitNesse is compiled for class file version 55) and a
`fitnesse-standalone.jar` (CI downloads `20241026`). The runner prints a per-page summary and fails
on any of: a missing expected page, a failing or errored assertion, an ignored assertion, a nonzero
FitNesse exit code, or fixture output that never reached FitNesse through the tunnel.

Useful overrides: `FITNESSE_JAVA` (path to `java`), `FITNESSE_JAR`, and the runner's own
`--jar/--java/--page/--port/--out` flags. `pnpm e2e:render` renders the wiki root on its own.

## Troubleshooting

| Symptom                                                     | Cause                                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `exitCode 97`, `Unexpected argument: 9123`                  | `%p` in `COMMAND_PATTERN` (it is the classpath, not the port)                                                                     |
| `defaultPath` appears in the command                        | Same as above                                                                                                                     |
| `COULD_NOT_INVOKE_CONSTRUCTOR MyFixture[0]`                 | The class could not be loaded: not under an import root, or the file/export name differs (its `Caused by:` chain says `NO_CLASS`) |
| `COULD_NOT_INVOKE_CONSTRUCTOR`                              | The class loaded but `new` threw (a `factory: true` export marked as a class?)                                                    |
| `NO_METHOD_IN_CLASS … Available methods:`                   | Wrong name, or too few parameters for the declared ones                                                                           |
| `TIMED_OUT <seconds>`                                       | The `-s` timeout elapsed (the call keeps running in the background)                                                               |
| `NO_CONVERTER_FOR_ARGUMENT_NUMBER`                          | A declared type has no converter registered                                                                                       |
| A cell shows a `?` link instead of running                  | CamelCase fixture name — escape it as `!-Name-!`                                                                                  |
| `check` reports the wrong value after a multi-argument call | Missing `;` on the action row                                                                                                     |
| `/__VOID__/` in a `check`                                   | The method returned `undefined`; compare against `/__VOID__/` or return a value                                                   |
