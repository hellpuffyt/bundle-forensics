# Production readiness — bundle-forensics

Audit of the `audit/production-readiness` branch. This document records evidence;
it does not award a production-ready label.

## Scope and architecture

A zero-dependency CLI and library that reads an esbuild metafile or webpack stats JSON and answers
`summary`, `packages`, `duplicates`, `modules`, `why` (BFS shortest import chain) and `diff`
(per-package/module/output deltas with a `--fail-on-growth` CI budget). Pure analysis core
(`src/*.ts` except `cli.ts` never touches the filesystem); structural validation of untrusted JSON
in `src/validate.ts`.

## Platforms and prerequisites

Node.js >= 20. Verified locally on macOS (Apple Silicon): full gate on Node 24.19.0, test suite on
Node 20 and 22. CI matrix (default branch): ubuntu / windows / macOS x Node 20 / 22 / 24; Windows
not run locally. Not published to npm — installed from a clone.

## Clean-clone setup (README)

```bash
git clone https://github.com/hellpuffyt/bundle-forensics && cd bundle-forensics
npm ci && npm run build
npm link
```

Fresh clone of the audit branch (with `npm link` pointed at a throwaway npm prefix): every step
exited 0; `bundle-forensics duplicates`, `why ... left-pad` and `diff ... --fail-on-growth 10000`
printed exactly the README output (diff exit 3: +14.0 kB over a 10 kB budget); typecheck, lint 0;
347 tests passed; tree clean afterwards.

Baseline README told users to `npm install -g bundle-forensics` / `npx bundle-forensics`; the name
is not on the npm registry (404), so the documented install could not work.

## Commands executed (CI-equivalent, local)

| Command | Baseline (main @ f1aaa79) | Audit branch |
|---|---|---|
| `npm ci` | 0 | 0 |
| `npm test` | 0 — 337 passed, 0 failed, 0 skipped | 0 — 347 passed, 0 failed, 0 skipped (Node 24, 20, 22) |
| `npm run build && node bin/bundle-forensics.js summary ...` | 0 | 0 |
| `npm run typecheck` / `npm run lint` | 0 / 0 | 0 / 0 |
| `npm run coverage` (95 % thresholds) | 0 — 100 / 97.97 / 100 / 100 | 0 — 100 / 98.04 / 100 / 100 (stmts / branches / funcs / lines) |
| CI dogfood (exact duplicates output, budget exit 3 / 0, runs without node_modules) | pass | pass |
| `npm audit --omit=dev` | 0 (no runtime deps) | 0 |
| `npm audit` (dev) | 7 (2 critical, 3 high, 2 moderate) | 4 (2 critical, 2 moderate) — vitest 3 chain, needs vitest 5 (semver-major) |

## Bugs fixed (regression tests: `test/audit-regressions.test.ts`; 7 of 10 fail on baseline)

| Bug | Impact | Fix |
|---|---|---|
| `diff --output` with a name in neither build | `0 B -> 0 B`, exit 0 under any `--fail-on-growth` — a CI budget silently disabled by a typo or a content-hashed chunk name | error (exit 1) listing real outputs; `why --output` checked too |
| Control characters from stats files written raw | a crafted module path could inject terminal escape sequences (cursor movement to hide lines, OSC 52 clipboard writes) | text and stderr escape C0/C1/DEL (newline/tab kept); JSON stays valid |
| Bin launcher committed without `+x` | `npm ci` dirtied a fresh checkout; launcher not directly executable | mode committed |
| README install via npm | package not published | install-from-clone instructions |

## Security review

| Area | Finding | Severity | Status |
|---|---|---|---|
| Untrusted input -> terminal | escape-sequence injection via module paths | Low/Medium | Fixed |
| CI gate integrity | `--output` typo disabled the size budget | Medium | Fixed |
| Parsing | `JSON.parse` + structural validation; nothing executed or fetched | Info | Verified by review and existing malformed-fixture tests |
| Resource use | 100k-module synthetic metafile: `summary` < 1 s, `duplicates` ~1 s, `why` ~1 s, `diff` ~2 s | Info | Measured locally |
| Supply chain (docs) | README pointed at an unpublished npm name | Low | Fixed |
| Workflow permissions | already `contents: read` | Info | none |
| Secrets in tree/history | 3 commits scanned, no hits | Info | none |

## Acceptance checklist

| Item | Expected behaviour | Command / test | Result | Reference |
|---|---|---|---|---|
| esbuild + webpack loading, format sniffing | both parse; wrong files rejected naming the key | `test/load.test.ts`, `test/validate.test.ts`, `test/webpack.test.ts` | pass | `src/load.ts` |
| Duplicates from install paths | nested `node_modules` copies detected, scoped names | `test/packages.test.ts`, CI dogfood | pass | `src/packages.ts` |
| `why` shortest chain | BFS, cycle-safe | `test/graph.test.ts` | pass | `src/graph.ts` |
| `diff` ledger + budget | per-package deltas; exit 3 over budget | `test/diff.test.ts`, CI dogfood | pass | `src/diff.ts`, `src/cli.ts` |
| Budget cannot be bypassed by a bad `--output` | exit 1 | audit tests | pass | `checkOutput` |
| Terminal-safe output | no raw control characters | audit tests | pass | `sanitizeForTerminal` |
| Exit-code contract 0/1/2/3 | as documented | `test/cli.test.ts` | pass | `src/cli.ts` |
| Zero runtime deps | runs with `node_modules` removed | CI job | pass (CI on default branch) | `package.json` |
| README install works | clone, build, link, run | clean clone | pass | README |

## CI status

- Default branch (`main` @ f1aaa79): last run `success`.
- Audit branch: pending until pushed.

## Limitations

webpack sizes are pre-minification and concatenated modules are not unpacked (documented);
duplicate detection is path-based (no version comparison); "recoverable" is a lower bound;
`why --top 0` on a very broad query runs one BFS per match.

## Tested commit

`9e32f43533deba5122fdad3d47d42a115612d385` (clean clone), 2026-10-22.

## Classification proposal

**Partially Verified** — documented scope implemented and tested locally (macOS, Node 20/22/24) and
from a clean clone; CI on the audit branch (including Windows) not yet run.
