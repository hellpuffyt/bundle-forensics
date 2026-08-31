# Contributing

Thanks for taking a look.

## Getting set up

```bash
git clone https://github.com/hellpuffyt/bundle-forensics
cd bundle-forensics
npm install
```

Node 20 or newer. There is nothing else to install — the tool has no
runtime dependencies and the test suite never runs a bundler.

## Before opening a pull request

All four must pass; CI runs the same commands.

```bash
npm run typecheck
npm run lint
npm test
npm run coverage
```

`npm run coverage` fails below 95% on statements, branches, functions or
lines. If a change drops coverage, the fix is a test, not a lower
threshold.

## Design constraints

These are the four rules the project is built around. A change that
breaks one of them is not a trade-off to discuss — it is a different
tool.

- **Zero runtime dependencies.** This gets installed with `npx` into
  other people's CI, often as the last step of an already slow build.
  Development dependencies are fine.
- **The analysis core is pure.** Nothing under `src/` except `cli.ts`
  touches the filesystem, the clock, the network or `process`.
  `loadBundle` takes a string. This is what lets the whole suite run
  against committed fixtures in a tenth of a second, and it is why
  every renderer can be asserted character for character.
- **Every format normalises into `model.ts` before analysis.**
  `graph.ts`, `packages.ts` and `diff.ts` do not know that esbuild or
  webpack exist. Adding a third bundler means writing one more loader,
  not touching the analysis.
- **Contribution and source size stay distinct.** `Module.bytes` is the
  file on disk; `Output.contributions` is what survived tree shaking
  into a specific chunk. Reports use the second. Conflating them is the
  single most common way bundle analysis lies to you.

## Adding a stats format

1. Write `src/<bundler>.ts` exporting `looksLike<Bundler>Stats(value)`
   and `from<Bundler>Stats(value, label)`. Validate through the helpers
   in `src/validate.ts` so a malformed file names its own bad key.
2. Wire it into `detectFormat` and `fromJson` in `src/load.ts`. The
   sniff must be narrow — a key or two — and must not overlap an
   existing format's sniff.
3. Commit a fixture under `fixtures/<bundler>/` and at least one
   malformed file under `fixtures/malformed/`. Fixtures are small and
   handwritten on purpose: a 4 MB real-world metafile makes a failing
   assertion unreadable.
4. If the format cannot supply post-tree-shaking sizes, say so in the
   module docstring **and** in the README. An approximation presented as
   a measurement is a bug.

## Adding a command

1. Put the analysis in the module it belongs to and export it from
   `src/index.ts`. If it is worth printing it is worth exporting.
2. Put the rendering in `src/report.ts` as a pure `data -> string`
   function. No colour, no `toLocaleString`: this output gets pasted
   into pull requests and diffed in CI, and `1,234` versus `1 234`
   depending on the runner's locale would make that useless.
3. Add the command to `COMMANDS` and `USAGE` in `src/cli.ts` and handle
   it in `dispatch`. Give it a `--json` shape as well as a text one.
4. Test it through `main` in `test/cli.test.ts`, asserting the exit code
   and both streams. Nothing there is mocked, so a passing test means
   the shipped binary behaves that way.

## Reporting a bug

A metafile that reproduces it is worth far more than a description, and
it does not have to be yours: `bundle-forensics` only reads paths and
byte counts, so replacing every source path with `a/b/c.js` and keeping
the shape reproduces almost every real bug in this tool. Include the
exact command line — `--output` and `--top` change the answer by design.

If the tool crashed with a stack trace rather than a one-line error,
that is always a bug worth reporting: `MetafileError` and `QueryError`
are the only failures it is supposed to have.
