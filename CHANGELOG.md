# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-08-31

First release.

### Added

- Six commands over a bundle stats file: `summary`, `packages`,
  `duplicates`, `modules`, `why` and `diff`, each with a `--json` shape
  alongside its text output.
- `why <module>` prints the shortest import chain from every entry point
  that reaches the module, with the kind of each hop
  (`import-statement`, `require-call`, `dynamic-import`) and the
  specifier as it was written in the source. The search is breadth-first
  and cycle-guarded, so barrel files cannot turn a two-hop answer into a
  twelve-hop one.
- Duplicate-dependency detection from install paths alone: a package
  reached through more than one `node_modules/` root is shipped more
  than once. Scoped packages, nested installs and Windows separators are
  all handled, and each duplicate reports the bytes recoverable by
  collapsing every copy into the largest.
- `diff` compares two builds by output file, npm package and individual
  module, sorted by the magnitude of the change rather than its sign,
  and reports duplicates that were resolved or introduced between them.
- `--fail-on-growth <bytes>`, which exits 3 when a diff's total grows
  past a budget, for use as a CI size gate. Exit codes are a contract:
  `0` success, `1` bad input or query, `2` bad command line, `3` over
  budget.
- esbuild metafiles as the primary format, using
  `outputs[o].inputs[i].bytesInOutput` — the real post-tree-shaking
  contribution of each module to each emitted file — rather than source
  size.
- webpack stats JSON as a secondary format, inverting each module's
  `reasons` into forward edges. Sizes are pre-minification and
  concatenated modules are not unpacked; both caveats are documented in
  the README rather than smoothed over.
- Lenient module queries, resolved in order: exact path, package name,
  path suffix, substring. Misses report near matches by file name;
  ambiguous queries list the candidates instead of guessing.
- `--output <file>` on every command, restricting the analysis to one
  emitted chunk.
- The whole analysis surface exported as a library from the package
  root, with the core kept pure — `loadBundle` takes a string, and
  nothing outside the CLI touches the filesystem.
- Structural validation that names the offending key
  (`inputs["src/index.ts"].bytes must be a non-negative number, found a
  string`) instead of throwing a `TypeError` from three frames deep,
  while tolerating unknown import kinds and absent optional fields so a
  bundler upgrade does not break the reader.

[0.1.0]: https://github.com/hellpuffyt/bundle-forensics/releases/tag/v0.1.0
