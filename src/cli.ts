/**
 * The command line.
 *
 * `main` takes its arguments and its two output sinks as parameters and
 * returns an exit code instead of calling `process.exit`. That is the
 * only reason the CLI is testable at all: every test in
 * `test/cli.test.ts` runs the real argument parsing, the real file
 * reads and the real renderers, and asserts on the exact bytes the user
 * would have seen.
 *
 * Exit codes are a contract, because this is meant to run in CI:
 *
 * | code | meaning |
 * | ---- | ------- |
 * | 0 | success |
 * | 1 | the input or the query was bad (a `MetafileError` or `QueryError`) |
 * | 2 | the command line itself was wrong |
 * | 3 | `diff --fail-on-growth` was exceeded |
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { diffBundles } from "./diff.js";
import { isExpectedError, QueryError } from "./errors.js";
import { resolveModules, whyIncluded } from "./graph.js";
import { loadBundle } from "./load.js";
import type { Bundle } from "./model.js";
import { contributionsByModule, entryPoints, totalBytes } from "./model.js";
import { findDuplicates, firstPartyBytes, packageReport } from "./packages.js";
import {
  formatBytes,
  renderDiff,
  renderDuplicates,
  renderModules,
  renderPackages,
  renderSummary,
  renderWhy,
} from "./report.js";
import { VERSION } from "./version.js";

/** Where the CLI writes. Injected so tests can capture it exactly. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

const COMMANDS = ["summary", "packages", "duplicates", "why", "modules", "diff"] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `bundle-forensics ${VERSION}
Explain a JavaScript bundle from its stats file.

USAGE
  bundle-forensics <command> [arguments] [options]

COMMANDS
  summary     <stats>            size, module and package totals
  packages    <stats>            every npm package, biggest first
  duplicates  <stats>            packages shipped from more than one install root
  modules     <stats>            every module, biggest first
  why         <stats> <module>   shortest import chain from each entry point
  diff        <before> <after>   what changed between two builds

OPTIONS
  --output <file>        restrict the analysis to one emitted file
  --top <n>              show at most n rows (default 20; 0 means all)
  --detail <kind>        diff rows: packages (default), modules or outputs
  --fail-on-growth <n>   exit 3 if diff total grew by more than n bytes
  --json                 machine-readable output
  -h, --help             this text
  -v, --version          print the version

Stats files are esbuild metafiles (esbuild --metafile=meta.json) or webpack
stats JSON (webpack --json > stats.json); the format is detected from the file.
`;

interface Options {
  readonly output: string | undefined;
  readonly top: number;
  readonly detail: "packages" | "modules" | "outputs";
  readonly failOnGrowth: number | undefined;
  readonly json: boolean;
}

/** A command line that does not make sense. Distinct exit code from bad data. */
class UsageError extends Error {}

function parseCount(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new UsageError(`${flag} needs a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function parseDetail(raw: string): Options["detail"] {
  if (raw === "packages" || raw === "modules" || raw === "outputs") return raw;
  throw new UsageError(
    `--detail must be packages, modules or outputs, got ${JSON.stringify(raw)}`,
  );
}

interface Parsed {
  readonly command: Command;
  readonly operands: readonly string[];
  readonly options: Options;
  /** Set when the user asked for help or the version instead of work. */
  readonly immediate?: string;
}

/** Splits argv into a command, its operands and its options. */
export function parseCommandLine(argv: readonly string[]): Parsed {
  const help: Parsed = {
    command: "summary",
    operands: [],
    options: { output: undefined, top: 20, detail: "packages", failOnGrowth: undefined, json: false },
    immediate: USAGE,
  };
  if (argv.length === 0) return help;

  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        output: { type: "string" },
        top: { type: "string" },
        detail: { type: "string" },
        "fail-on-growth": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const flags = parsed.values;
  if (flags.help) return help;
  if (flags.version) return { ...help, immediate: `${VERSION}\n` };

  const [name, ...operands] = parsed.positionals;
  if (name === undefined) return help;
  if (!(COMMANDS as readonly string[]).includes(name)) {
    throw new UsageError(
      `unknown command ${JSON.stringify(name)}; expected one of ${COMMANDS.join(", ")}`,
    );
  }

  const topRaw = flags.top;
  const growthRaw = flags["fail-on-growth"];
  return {
    command: name as Command,
    operands,
    options: {
      output: flags.output,
      top: topRaw === undefined ? 20 : parseCount(topRaw, "--top"),
      detail: flags.detail === undefined ? "packages" : parseDetail(flags.detail),
      failOnGrowth: growthRaw === undefined ? undefined : parseCount(growthRaw, "--fail-on-growth"),
      json: flags.json,
    },
  };
}

function need(operands: readonly string[], index: number, what: string): string {
  const value = operands[index];
  if (value === undefined) throw new UsageError(`missing ${what}`);
  return value;
}

async function read(path: string): Promise<Bundle> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new QueryError(
      code === "ENOENT" ? `no such file: ${path}` : `cannot read ${path}: ${String(error)}`,
    );
  }
  return loadBundle(text, path);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** `top` of 0 means "everything", which is easier to type than a big number. */
function limit(options: Options): number {
  return options.top === 0 ? Number.MAX_SAFE_INTEGER : options.top;
}

function summaryJson(bundle: Bundle, output: string | undefined): unknown {
  const total = totalBytes(bundle, output);
  const firstParty = firstPartyBytes(bundle, output);
  return {
    label: bundle.label,
    format: bundle.format,
    totalBytes: total,
    firstPartyBytes: firstParty,
    dependencyBytes: total - firstParty,
    moduleCount: contributionsByModule(bundle, output).size,
    packageCount: packageReport(bundle, output).length,
    duplicateCount: findDuplicates(bundle, output).length,
    entryPoints: entryPoints(bundle),
    outputs: [...bundle.outputs.values()]
      .filter((entry) => output === undefined || entry.path === output)
      .map((entry) => ({
        path: entry.path,
        bytes: entry.bytes,
        moduleCount: entry.contributions.size,
        entryPoint: entry.entryPoint ?? null,
      })),
  };
}

/** Rejects an `--output` that names no emitted file in any of the given builds. */
function checkOutput(options: Options, ...bundles: readonly Bundle[]): void {
  const output = options.output;
  if (output === undefined) return;
  if (bundles.some((bundle) => bundle.outputs.has(output))) return;
  const known = new Set<string>();
  for (const bundle of bundles) for (const name of bundle.outputs.keys()) known.add(name);
  throw new QueryError(
    `no output named ${JSON.stringify(output)} in ${bundles.map((b) => b.label).join(" or ")}`,
    [...known].sort(),
  );
}

/**
 * Makes text safe to print to a terminal. Stats files are untrusted input
 * (CI artefacts, files from colleagues), and a module path containing ESC
 * or other control characters could otherwise rewrite the terminal — e.g.
 * hide a regression line, or set the clipboard via OSC 52. Newlines and
 * tabs produced by the renderers are kept; every other C0/C1 control
 * character (and DEL) is shown as a visible \u escape.
 */
export function sanitizeForTerminal(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

async function runWhy(
  operands: readonly string[],
  options: Options,
  io: Io,
): Promise<void> {
  const bundle = await read(need(operands, 0, "a stats file"));
  checkOutput(options, bundle);
  const query = need(operands, 1, "a module to explain");
  const matches = resolveModules(bundle, query).slice(0, limit(options));
  const contributions = contributionsByModule(bundle, options.output);

  if (options.json) {
    io.stdout(
      json(
        matches.map((path) => ({
          module: path,
          bytes: contributions.get(path) ?? 0,
          chains: whyIncluded(bundle, path),
        })),
      ),
    );
    return;
  }
  io.stdout(
    matches
      .map((path) => renderWhy(path, whyIncluded(bundle, path), contributions.get(path) ?? 0))
      .join("\n"),
  );
}

async function runDiff(
  operands: readonly string[],
  options: Options,
  io: Io,
): Promise<number> {
  const before = await read(need(operands, 0, "a stats file for the older build"));
  const after = await read(need(operands, 1, "a stats file for the newer build"));
  // An --output present in neither build used to diff 0 B against 0 B and
  // pass any --fail-on-growth budget silently (e.g. a hashed chunk name).
  checkOutput(options, before, after);
  const result = diffBundles(before, after, options.output);
  io.stdout(options.json ? json(result) : renderDiff(result, limit(options), options.detail));

  const budget = options.failOnGrowth;
  if (budget !== undefined && result.totalDelta > budget) {
    io.stderr(
      `bundle grew by ${formatBytes(result.totalDelta)}, over the ` +
        `${formatBytes(budget)} budget\n`,
    );
    return 3;
  }
  return 0;
}

async function dispatch(parsed: Parsed, io: Io): Promise<number> {
  const { command, operands, options } = parsed;
  if (command === "diff") return runDiff(operands, options, io);
  if (command === "why") {
    await runWhy(operands, options, io);
    return 0;
  }

  const bundle = await read(need(operands, 0, "a stats file"));
  checkOutput(options, bundle);
  const total = totalBytes(bundle, options.output);

  switch (command) {
    case "summary":
      io.stdout(
        options.json ? json(summaryJson(bundle, options.output)) : renderSummary(bundle, options.output),
      );
      return 0;
    case "packages": {
      const reports = packageReport(bundle, options.output).slice(0, limit(options));
      io.stdout(options.json ? json(reports) : renderPackages(reports, total));
      return 0;
    }
    case "duplicates": {
      const duplicates = findDuplicates(bundle, options.output).slice(0, limit(options));
      io.stdout(options.json ? json(duplicates) : renderDuplicates(duplicates));
      return 0;
    }
    case "modules": {
      const contributions = contributionsByModule(bundle, options.output);
      if (options.json) {
        const rows = [...contributions]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, limit(options))
          .map(([path, bytes]) => ({ path, bytes }));
        io.stdout(json(rows));
      } else {
        io.stdout(renderModules(contributions, total, limit(options)));
      }
      return 0;
    }
  }
}

/**
 * Runs one command line. Returns the process exit code; never throws.
 *
 * Unexpected errors are re-raised as a stack trace on stderr rather than
 * being flattened into a friendly one-liner — a `TypeError` from inside
 * the analysis is a bug in this tool, and disguising it as a user error
 * is how such bugs go unreported for a year.
 */
export async function main(argv: readonly string[], rawIo: Io): Promise<number> {
  const io: Io = {
    stdout: (text) => {
      rawIo.stdout(sanitizeForTerminal(text));
    },
    stderr: (text) => {
      rawIo.stderr(sanitizeForTerminal(text));
    },
  };
  try {
    const parsed = parseCommandLine(argv);
    if (parsed.immediate !== undefined) {
      io.stdout(parsed.immediate);
      return 0;
    }
    return await dispatch(parsed, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`bundle-forensics: ${error.message}\n`);
      io.stderr("run 'bundle-forensics --help' for usage\n");
      return 2;
    }
    if (isExpectedError(error)) {
      io.stderr(`bundle-forensics: ${error.message}\n`);
      if (error instanceof QueryError && error.suggestions.length > 0) {
        io.stderr(`did you mean: ${error.suggestions.join(", ")}\n`);
      }
      return 1;
    }
    io.stderr(`bundle-forensics: internal error\n${String(error)}\n`);
    return 70;
  }
}
