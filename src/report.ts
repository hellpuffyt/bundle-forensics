/**
 * Turning analysis into text.
 *
 * Everything here is a pure `data -> string` function so the output can
 * be asserted character for character in tests, and so nothing in the
 * analysis ever needs to know about a terminal. There is no colour and
 * no locale formatting: this output gets pasted into pull requests and
 * diffed in CI, and `1,234` vs `1 234` depending on the runner's locale
 * would make that useless.
 *
 * Sizes are shown in kB/MB of 1000 bytes, matching how bundlers,
 * browsers and CDNs report transfer size. Anything under 1000 bytes is
 * printed exactly, because that is the range where rounding hides the
 * thing you were looking for.
 */

import type { BundleDiff, Change } from "./diff.js";
import type { Chain } from "./graph.js";
import type { Bundle } from "./model.js";
import { contributionsByModule, entryPoints, totalBytes } from "./model.js";
import type { Duplicate, PackageReport } from "./packages.js";
import { firstPartyBytes, packageReport } from "./packages.js";

/** Human-readable size. Exact under 1 kB, one decimal above it. */
export function formatBytes(bytes: number): string {
  const magnitude = Math.abs(bytes);
  if (magnitude < 1000) return `${bytes} B`;
  if (magnitude < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1000 / 1000).toFixed(2)} MB`;
}

/** A size change, always carrying its sign so a diff reads at a glance. */
export function formatDelta(bytes: number): string {
  if (bytes === 0) return "±0 B";
  return `${bytes > 0 ? "+" : "-"}${formatBytes(Math.abs(bytes))}`;
}

/** `n%` of `total`, or `—` when the total is zero. */
export function formatShare(bytes: number, total: number): string {
  if (total <= 0) return "—";
  return `${((bytes / total) * 100).toFixed(1)}%`;
}

/** Right-aligns a column of sizes; everything else is left-aligned. */
export type Align = "left" | "right";

/**
 * Renders a fixed-width table with two spaces between columns.
 *
 * Trailing whitespace is trimmed from every line, which is what makes
 * the output safe to assert on: an invisible run of padding at the end
 * of a row is the classic reason a golden-output test is unreadable when
 * it fails.
 */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  align: readonly Align[] = [],
): string {
  const widths = headers.map((header, column) =>
    rows.reduce((width, row) => Math.max(width, (row[column] ?? "").length), header.length),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? cell.length;
        return align[column] === "right" ? cell.padStart(width) : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  const separator = widths.map((width) => "-".repeat(width));
  return [line(headers), line(separator), ...rows.map(line)].join("\n") + "\n";
}

/**
 * A two-column label/value block, with no header row.
 *
 * Distinct from `table` because a header of two empty strings still
 * renders a rule of dashes above the first row, which looks like a bug.
 */
export function definitions(rows: readonly (readonly [string, string])[]): string {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
  const values = rows.reduce((max, [, value]) => Math.max(max, value.length), 0);
  const lines = rows.map(([label, value]) =>
    `${label.padEnd(width)}  ${value.padStart(values)}`.trimEnd(),
  );
  return lines.join("\n") + "\n";
}

function section(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

/** The `summary` command. */
export function renderSummary(bundle: Bundle, output?: string): string {
  const total = totalBytes(bundle, output);
  const contributions = contributionsByModule(bundle, output);
  const packages = packageReport(bundle, output);
  const duplicated = packages.filter((entry) => entry.copies.length > 1);
  const firstParty = firstPartyBytes(bundle, output);

  const facts: [string, string][] = [
    ["stats format", bundle.format],
    ["outputs", String(output === undefined ? bundle.outputs.size : 1)],
    ["modules", String(contributions.size)],
    ["packages", String(packages.length)],
    ["duplicated packages", String(duplicated.length)],
    ["total size", formatBytes(total)],
    ["first-party", `${formatBytes(firstParty)} (${formatShare(firstParty, total)})`],
    [
      "dependencies",
      `${formatBytes(total - firstParty)} (${formatShare(total - firstParty, total)})`,
    ],
  ];

  const outputRows = [...bundle.outputs.values()]
    .filter((entry) => output === undefined || entry.path === output)
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .map((entry) => [
      entry.path,
      formatBytes(entry.bytes),
      String(entry.contributions.size),
      entry.entryPoint ?? "—",
    ]);

  return [
    section(bundle.label, definitions(facts)),
    section(
      "outputs",
      table(
        ["output", "size", "modules", "entry point"],
        outputRows,
        ["left", "right", "right", "left"],
      ),
    ),
  ].join("\n");
}

/** The `packages` command. */
export function renderPackages(
  reports: readonly PackageReport[],
  total: number,
): string {
  if (reports.length === 0) return "no packages contribute to this build\n";
  const rows = reports.map((entry) => [
    entry.name,
    formatBytes(entry.bytes),
    formatShare(entry.bytes, total),
    String(entry.moduleCount),
    entry.copies.length > 1 ? `${entry.copies.length} copies` : "",
  ]);
  return table(
    ["package", "size", "share", "modules", "note"],
    rows,
    ["left", "right", "right", "right", "left"],
  );
}

/** The `duplicates` command. */
export function renderDuplicates(duplicates: readonly Duplicate[]): string {
  if (duplicates.length === 0) return "no duplicated packages\n";
  const blocks = duplicates.map((entry) => {
    const rows = entry.copies.map((copy) => [
      copy.root,
      formatBytes(copy.bytes),
      String(copy.moduleCount),
    ]);
    const heading =
      `${entry.name}  ${formatBytes(entry.bytes)} in ${entry.copies.length} copies, ` +
      `${formatBytes(entry.wastedBytes)} recoverable`;
    return section(heading, table(["install root", "size", "modules"], rows, ["left", "right", "right"]));
  });
  return blocks.join("\n");
}

/** The `why` command, for one resolved module. */
export function renderWhy(
  modulePath: string,
  chains: readonly Chain[],
  bytes: number,
): string {
  const header = `${modulePath}  (${formatBytes(bytes)} in the bundle)\n`;
  if (chains.length === 0) {
    return `${header}\n  no entry point reaches this module\n`;
  }
  const blocks = chains.map((chain) => {
    const lines = [`  from ${chain.entry}`];
    if (chain.links.length === 0) {
      lines.push("    (this module is the entry point)");
    }
    chain.links.forEach((link, index) => {
      const specifier = link.original === undefined ? "" : ` "${link.original}"`;
      lines.push(`    ${"  ".repeat(index)}-> ${link.to}  [${link.kind}${specifier}]`);
    });
    return lines.join("\n");
  });
  return `${header}\n${blocks.join("\n\n")}\n`;
}

function changeRows(rows: readonly Change[]): string[][] {
  return rows.map((row) => [
    row.key,
    row.status,
    formatBytes(row.before),
    formatBytes(row.after),
    formatDelta(row.delta),
  ]);
}

const CHANGE_HEADERS = ["name", "change", "before", "after", "delta"] as const;
const CHANGE_ALIGN: Align[] = ["left", "left", "right", "right", "right"];

/** The `diff` command. */
export function renderDiff(
  diff: BundleDiff,
  limit: number,
  detail: "packages" | "modules" | "outputs",
): string {
  const rows =
    detail === "modules"
      ? diff.modules
      : detail === "outputs"
        ? diff.outputs
        : diff.packages;
  const shown = rows.slice(0, limit);
  const parts: string[] = [];

  parts.push(
    section(
      `${diff.beforeLabel} -> ${diff.afterLabel}`,
      definitions([
        ["before", formatBytes(diff.totalBefore)],
        ["after", formatBytes(diff.totalAfter)],
        ["delta", formatDelta(diff.totalDelta)],
      ]),
    ),
  );

  parts.push(
    section(
      detail,
      shown.length === 0 ? "no changes\n" : table(CHANGE_HEADERS, changeRows(shown), CHANGE_ALIGN),
    ),
  );

  if (rows.length > shown.length) {
    parts.push(`... ${rows.length - shown.length} more rows (use --top)\n`);
  }
  if (diff.duplicatesResolved.length > 0) {
    parts.push(`duplicates resolved: ${diff.duplicatesResolved.join(", ")}\n`);
  }
  if (diff.duplicatesIntroduced.length > 0) {
    parts.push(`duplicates introduced: ${diff.duplicatesIntroduced.join(", ")}\n`);
  }
  return parts.join("\n");
}

/** The `tree` command: what an output is made of, biggest module first. */
export function renderModules(
  contributions: ReadonlyMap<string, number>,
  total: number,
  limit: number,
): string {
  const rows = [...contributions]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([path, bytes]) => [path, formatBytes(bytes), formatShare(bytes, total)]);
  if (rows.length === 0) return "no modules\n";
  return table(["module", "size", "share"], rows, ["left", "right", "right"]);
}

/** Entry points, for `summary --json` and for error messages. */
export function describeEntryPoints(bundle: Bundle): string {
  const entries = entryPoints(bundle);
  return entries.length === 0 ? "none" : entries.join(", ");
}
