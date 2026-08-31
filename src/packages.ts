/**
 * Attributing modules to npm packages, and finding duplicates.
 *
 * The whole file rests on one observation: a resolved module path
 * records its own install location. `node_modules/a/node_modules/b/x.js`
 * is package `b`, installed privately under `a` — a *second copy* of `b`
 * if `b` also appears at the top level. That is the duplicate-dependency
 * bug, and it is visible in the path alone, with no lockfile, no
 * registry lookup and no network.
 *
 * The rule is therefore: the package is whatever follows the **last**
 * `node_modules/` segment, and the install root is everything up to and
 * including that package directory. Modules with no `node_modules/`
 * segment are first-party and belong to no package.
 */

import type { Bundle } from "./model.js";
import { contributionsByModule } from "./model.js";

const NODE_MODULES = "node_modules/";

/** A package name split from an install path, plus where it was installed. */
export interface PackageLocation {
  /** The npm package name, scope included: `react`, `@babel/runtime`. */
  readonly name: string;
  /** Path prefix ending at the package directory, without a trailing slash. */
  readonly root: string;
}

/** Normalises Windows separators so path logic has one shape to handle. */
function slashes(path: string): string {
  return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}

/**
 * Splits a resolved module path into its package name and install root.
 *
 * Returns `undefined` for first-party source and for anything that names
 * `node_modules` without a package after it.
 */
export function packageLocation(modulePath: string): PackageLocation | undefined {
  const path = slashes(modulePath);
  const marker = path.lastIndexOf(NODE_MODULES);
  if (marker === -1) return undefined;

  const after = path.slice(marker + NODE_MODULES.length);
  const parts = after.split("/").filter((part) => part !== "");
  const first = parts[0];
  if (first === undefined) return undefined;

  // A scoped package spends two segments on its name.
  const segments = first.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  if (first.startsWith("@") && segments.length < 2) return undefined;

  const name = segments.join("/");
  return { name, root: path.slice(0, marker + NODE_MODULES.length) + name };
}

/** The package a module belongs to, or `undefined` if it is first-party. */
export function packageOf(modulePath: string): string | undefined {
  return packageLocation(modulePath)?.name;
}

/** One installed copy of a package: where it lives and what it costs. */
export interface PackageCopy {
  readonly root: string;
  readonly bytes: number;
  readonly moduleCount: number;
  readonly modules: readonly string[];
}

/** A package rolled up across every copy of it in the bundle. */
export interface PackageReport {
  readonly name: string;
  /** Bytes contributed to the selected outputs by every copy combined. */
  readonly bytes: number;
  readonly moduleCount: number;
  /** One entry per install root, biggest first. More than one is a duplicate. */
  readonly copies: readonly PackageCopy[];
}

/** Sorts by bytes descending, then by name so output is fully deterministic. */
function byBytesThen<T extends { bytes: number }>(
  tiebreak: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) => b.bytes - a.bytes || tiebreak(a).localeCompare(tiebreak(b));
}

/**
 * Rolls every module up into its package.
 *
 * `output` restricts the byte counts to a single emitted file; modules
 * that contribute nothing to it drop out entirely, which is what makes
 * "what is in `vendor.js`" a different answer from "what is in the
 * build".
 */
export function packageReport(
  bundle: Bundle,
  output?: string,
): PackageReport[] {
  const contributions = contributionsByModule(bundle, output);
  type Copy = { bytes: number; modules: string[] };
  const byName = new Map<string, Map<string, Copy>>();

  for (const [modulePath, bytes] of contributions) {
    const location = packageLocation(modulePath);
    if (location === undefined) continue;
    const roots = byName.get(location.name) ?? new Map<string, Copy>();
    const copy: Copy = roots.get(location.root) ?? { bytes: 0, modules: [] };
    copy.bytes += bytes;
    copy.modules.push(modulePath);
    roots.set(location.root, copy);
    byName.set(location.name, roots);
  }

  const reports: PackageReport[] = [];
  for (const [name, roots] of byName) {
    const copies: PackageCopy[] = [];
    let bytes = 0;
    let moduleCount = 0;
    for (const [root, copy] of roots) {
      copies.push({
        root,
        bytes: copy.bytes,
        moduleCount: copy.modules.length,
        modules: [...copy.modules].sort(),
      });
      bytes += copy.bytes;
      moduleCount += copy.modules.length;
    }
    copies.sort(byBytesThen((copy: PackageCopy) => copy.root));
    reports.push({ name, bytes, moduleCount, copies });
  }
  reports.sort(byBytesThen((report: PackageReport) => report.name));
  return reports;
}

/**
 * Bytes not attributable to any package — the first-party source.
 *
 * Reported separately rather than folded into a fake package, because
 * "your own code is 4% of the bundle" is usually the headline.
 */
export function firstPartyBytes(bundle: Bundle, output?: string): number {
  let bytes = 0;
  for (const [modulePath, contributed] of contributionsByModule(bundle, output)) {
    if (packageLocation(modulePath) === undefined) bytes += contributed;
  }
  return bytes;
}

/** A package shipped from more than one install root. */
export interface Duplicate extends PackageReport {
  /**
   * Bytes that would disappear if every copy collapsed into the largest.
   *
   * A lower bound on the win, not a promise: deduplicating can only ever
   * remove the smaller copies, and only if the versions are compatible.
   */
  readonly wastedBytes: number;
}

/** Packages present at more than one install root, worst waste first. */
export function findDuplicates(
  bundle: Bundle,
  output?: string,
): Duplicate[] {
  const duplicates: Duplicate[] = [];
  for (const report of packageReport(bundle, output)) {
    if (report.copies.length < 2) continue;
    const largest = report.copies[0]?.bytes ?? 0;
    duplicates.push({ ...report, wastedBytes: report.bytes - largest });
  }
  duplicates.sort(
    (a, b) => b.wastedBytes - a.wastedBytes || a.name.localeCompare(b.name),
  );
  return duplicates;
}
