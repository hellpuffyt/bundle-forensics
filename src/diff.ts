/**
 * Comparing two builds.
 *
 * "The bundle grew by 14 kB" is not actionable; "`date-fns` arrived and
 * costs 18 kB, `left-pad` left and saved 600 B" is. So the diff is
 * computed at three levels — output file, npm package, individual module
 * — from the same primitive: contributed bytes before, contributed bytes
 * after.
 *
 * Rows are sorted by the **magnitude** of the change, not its sign,
 * because a regression hunt cares equally about the thing that grew and
 * the thing that vanished. Unchanged rows are dropped: a diff that lists
 * the 4,000 modules that stayed the same is a treemap with extra steps.
 */

import type { Bundle } from "./model.js";
import { contributionsByModule, totalBytes } from "./model.js";
import { findDuplicates, packageOf, packageReport } from "./packages.js";

/** What happened to one row between the two builds. */
export type ChangeStatus = "added" | "removed" | "grew" | "shrank" | "unchanged";

/** One before/after comparison, whatever the row is keyed by. */
export interface Change {
  readonly key: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly status: ChangeStatus;
}

function classify(before: number, after: number): ChangeStatus {
  if (before === 0 && after > 0) return "added";
  if (after === 0 && before > 0) return "removed";
  if (after > before) return "grew";
  if (after < before) return "shrank";
  return "unchanged";
}

/**
 * Joins two keyed byte tables into sorted `Change` rows.
 *
 * Exported because it is the entire diff algorithm: everything else in
 * this module is a different way of producing the two tables.
 */
export function changes(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  options: { readonly includeUnchanged?: boolean } = {},
): Change[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const rows: Change[] = [];
  for (const key of keys) {
    const was = before.get(key) ?? 0;
    const now = after.get(key) ?? 0;
    const status = classify(was, now);
    if (status === "unchanged" && options.includeUnchanged !== true) continue;
    rows.push({ key, before: was, after: now, delta: now - was, status });
  }
  rows.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key),
  );
  return rows;
}

/** The full comparison of two builds. */
export interface BundleDiff {
  readonly beforeLabel: string;
  readonly afterLabel: string;
  readonly totalBefore: number;
  readonly totalAfter: number;
  readonly totalDelta: number;
  readonly outputs: readonly Change[];
  readonly packages: readonly Change[];
  readonly modules: readonly Change[];
  /** Packages duplicated in the older build and no longer duplicated. */
  readonly duplicatesResolved: readonly string[];
  /** Packages newly duplicated in the newer build. */
  readonly duplicatesIntroduced: readonly string[];
}

function outputBytes(bundle: Bundle): Map<string, number> {
  const table = new Map<string, number>();
  for (const output of bundle.outputs.values()) table.set(output.path, output.bytes);
  return table;
}

function packageBytes(bundle: Bundle, output: string | undefined): Map<string, number> {
  const table = new Map<string, number>();
  for (const report of packageReport(bundle, output)) table.set(report.name, report.bytes);
  // First-party source is not a package but still moves between builds,
  // so it gets one synthetic row rather than silently vanishing.
  let firstParty = 0;
  for (const [path, bytes] of contributionsByModule(bundle, output)) {
    if (packageOf(path) === undefined) firstParty += bytes;
  }
  if (firstParty > 0) table.set("(first-party)", firstParty);
  return table;
}

function duplicateNames(bundle: Bundle, output: string | undefined): Set<string> {
  return new Set(findDuplicates(bundle, output).map((entry) => entry.name));
}

/** Compares two builds, optionally restricted to one output file. */
export function diffBundles(
  before: Bundle,
  after: Bundle,
  output?: string,
): BundleDiff {
  const wasDuplicated = duplicateNames(before, output);
  const isDuplicated = duplicateNames(after, output);
  return {
    beforeLabel: before.label,
    afterLabel: after.label,
    totalBefore: totalBytes(before, output),
    totalAfter: totalBytes(after, output),
    totalDelta: totalBytes(after, output) - totalBytes(before, output),
    outputs: changes(outputBytes(before), outputBytes(after)),
    packages: changes(packageBytes(before, output), packageBytes(after, output)),
    modules: changes(
      contributionsByModule(before, output),
      contributionsByModule(after, output),
    ),
    duplicatesResolved: [...wasDuplicated].filter((n) => !isDuplicated.has(n)).sort(),
    duplicatesIntroduced: [...isDuplicated].filter((n) => !wasDuplicated.has(n)).sort(),
  };
}
