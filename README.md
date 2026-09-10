# @killertux/js-slim

A typed SLiM protocol harness/server for [FitNesse](https://fitnesse.org/), for Node.js —
usable from both TypeScript and plain JavaScript.

> **Status:** early development. The implementation is being built step by step; see
> [`PLAN.md`](./PLAN.md) for the full design and roadmap.

## What it is

FitNesse drives acceptance tests by launching a _SLiM server_ and speaking a small
length-prefixed list protocol with it. `@killertux/js-slim` is that server for the Node.js
ecosystem: it resolves fixture classes from JS/TS modules, converts arguments, invokes
methods, tracks symbols, and returns results — so you can write FitNesse fixtures in
TypeScript or JavaScript.

## Requirements

- Node.js `>= 20`

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` emits dual ESM + CJS output with type declarations into `dist/`.

## License

MIT
