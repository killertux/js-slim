# Protocol notes

The SLiM wire protocol as implemented here, plus the places where this implementation is stricter or
more forgiving than Java's FitNesse. Behaviour matches `fitnesse.slim.protocol.SlimSerializer`,
`SlimDeserializer` and `SlimStreamReader` unless stated otherwise.

## Connection

The server writes one un-prefixed header line and then exchanges length-prefixed frames:

```text
Slim -- V0.5\n
```

```text
000020:[000001:000003:bye:]
```

- The header is `Slim -- V<version>`; the version is `0.5` (`PROTOCOL_VERSION`).
- A frame prefix is the payload's **byte** length as at least 6 zero-padded ASCII digits followed
  by `:`. Longer messages grow the digit count (up to 15 digits are accepted); the frame limit is
  64 MiB by default (`FrameReader`'s `maxFrameBytes`).- `bye` (case-insensitive) ends the session; a clean EOF does too.
- A frame prefix shorter than 6 digits, missing its `:`, or non-numeric is a transport error: the
  connection fails and the CLI reports exit code `98`.

## Message shape

Every message is a serialized list. Requests are instructions; responses are `[id, value]` rows with
the same ids, in order.

```text
[id, operation, args…]
```

| Operation       | Arguments                                           |
| --------------- | --------------------------------------------------- |
| `import`        | `path`                                              |
| `make`          | `instanceName`, `className`, `args…`                |
| `call`          | `instanceName`, `methodName`, `args…`               |
| `callAndAssign` | `symbolName`, `instanceName`, `methodName`, `args…` |
| `assign`        | `symbolName`, `value`                               |

`make` answers `OK`; a call answers its result. A structurally invalid instruction becomes an
exception row for that id and the batch continues (Java aborts the whole session here).

## List serialization

```text
[<count>:<length>:<item>:<length>:<item>:…]
```

- `count` and `length` are 6-digit-minimum, colon-terminated decimal prefixes.
- **Inner lengths are UTF-16 code units** (JavaScript's `String#length`), while the outer frame
  prefix is **bytes**. This asymmetry is the classic porting bug; both directions are tested
  explicitly, including surrogate pairs and multi-byte characters.
- A nested list is serialized in place as its own `[…]` value, so lists nest arbitrarily; the decoder
  rejects nesting deeper than **500** (`MAX_NESTING_DEPTH`).
- `null` and `undefined` serialize as the literal string `null`. Note that a fixture returning
  `undefined` renders as the void tag (`/__VOID__/`), not `null`.
- Numbers and booleans are stringified; there is no numeric wire type.
- FitNesse hash tables are HTML `<table>` markup inside a single string; lists of alternating keys
  and values are what FitNesse displays as a table.

## Results and errors

| Value             | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `OK`              | `make` succeeded                                         |
| `null`            | Explicit null (a Java `null` return)                     |
| `/__VOID__/`      | The method returned `undefined` (Java's `VoidConverter`) |
| `[…]`             | A list result, rendered recursively                      |
| `__EXCEPTION__:…` | The instruction failed                                   |

An error is a single string with the tag wrapped in FitNesse's pretty-print markers, followed by the
stack trace:

```text
__EXCEPTION__:message:<<NO_METHOD_IN_CLASS No Method add[2] in class Calculator.
 Available methods:
add(0)
total(0)>>

    at …
```

Tags produced by the runtime (`SLIM_ERROR`):

| Tag                                | When                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `MALFORMED_INSTRUCTION`            | The instruction row could not be parsed                    |
| `NO_CLASS`                         | The fixture class could not be resolved                    |
| `COULD_NOT_INVOKE_CONSTRUCTOR`     | The class loaded but construction failed                   |
| `NO_INSTANCE`                      | No such instance (and no library matched)                  |
| `NO_METHOD_IN_CLASS`               | No method with a matching name and arity                   |
| `NO_CONVERTER_FOR_ARGUMENT_NUMBER` | A declared type has no registered converter                |
| `TIMED_OUT`                        | The `-s` timeout elapsed: `message:<<TIMED_OUT <seconds>>` |

Stop/ignore markers are passed through bare (FitNesse compares them exactly):

```text
__EXCEPTION__:ABORT_SLIM_TEST:
__EXCEPTION__:ABORT_SLIM_SUITE:
__EXCEPTION__:IGNORE_SCRIPT_TEST:
__EXCEPTION__:IGNORE_ALL_TESTS:
```

A stop/ignore ends the current batch early and the following instructions are not sent a response.

## Pipe-mode output tunnel

In stdin/stdout mode **stdout carries the protocol**, so anything a fixture writes to the console
would corrupt the stream. The CLI therefore patches `process.stdout`/`process.stderr` and forwards
the captured text over the protocol's own channel, one prefixed record per write:

```text
SOUT.:hello from the fixture
SERR.:a warning
```

Continuation lines of a multi-line record use `<LEVEL> :` instead of `<LEVEL>.:`, matching Java's
`LoggingOutputStream`. FitNesse strips the prefixes and attributes the text to the page's stdout or
stderr. The tunnel is installed only in pipe mode — in TCP mode the protocol runs over the socket, so
fixture output stays on the process's ordinary stdout.

## Differences from Java FitNesse

Beyond the protocol details above (nesting limit, per-row error recovery), the runtime diverges
deliberately:

- **Arity matching.** Java matches an exact parameter count. Here an exact match anywhere in the
  receiver chain wins before a relaxed one, and a method declaring _fewer_ parameters than the call
  still matches because JavaScript ignores extra arguments. So `add(...values)` accepts any arity,
  and `fn.length` for a rest-parameter method is reported as `0` in diagnostics.
- **Static methods are not fixture methods.** Only instance methods (own or inherited) resolve.
- **Dates are UTC**, not host-local; the format is `dd-MMM-yyyy`.
- **`Timeout` is a race, not cancellation.** The instruction keeps running in the background.
- **Backtick expressions** (`SlimExpressionEvaluator`) are not implemented; the text is left literal.
- **Non-string symbol values.** A `$symbol` may hold an object, which a converter passes through when
  it already matches the declared type and stringifies otherwise.
- **Declared names for package roots.** Package-specifier import roots resolve by export path only.

## Client library

`SlimClient` implements the FitNesse side of this protocol (header handshake, framed batch exchange,
`bye`) and is used by the integration tests and the acceptance suite; it is exported for embedding
and debugging rather than for production use.
