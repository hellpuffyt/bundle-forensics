/**
 * bundle-forensics as a library.
 *
 * The CLI is one consumer of this surface and gets no privileges: every
 * command is `loadBundle` followed by one exported analysis function
 * followed by one exported renderer. If something is worth printing it
 * is worth exporting, so a CI script can compute it and decide for
 * itself.
 *
 * ```ts
 * import { loadBundle, findDuplicates } from "bundle-forensics";
 * import { readFile } from "node:fs/promises";
 *
 * const bundle = loadBundle(await readFile("meta.json", "utf8"), "meta.json");
 * for (const duplicate of findDuplicates(bundle)) {
 *   console.log(duplicate.name, duplicate.copies.length, duplicate.wastedBytes);
 * }
 * ```
 */

export { MetafileError, QueryError, isExpectedError } from "./errors.js";
export type { Bundle, ImportKind, Module, ModuleImport, Output } from "./model.js";
export { contributionsByModule, entryPoints, totalBytes } from "./model.js";

export { detectFormat, fromJson, loadBundle } from "./load.js";
export { fromEsbuildMetafile, looksLikeEsbuildMetafile } from "./esbuild.js";
export { fromWebpackStats, looksLikeWebpackStats, reasonKind } from "./webpack.js";

export type { Chain, Link } from "./graph.js";
export {
  imports,
  importedBy,
  orphanModules,
  reachableFrom,
  resolveModules,
  resolveOneModule,
  shortestChain,
  whyIncluded,
} from "./graph.js";

export type { Duplicate, PackageCopy, PackageLocation, PackageReport } from "./packages.js";
export {
  findDuplicates,
  firstPartyBytes,
  packageLocation,
  packageOf,
  packageReport,
} from "./packages.js";

export type { BundleDiff, Change, ChangeStatus } from "./diff.js";
export { changes, diffBundles } from "./diff.js";

export type { Align } from "./report.js";
export {
  definitions,
  describeEntryPoints,
  formatBytes,
  formatDelta,
  formatShare,
  renderDiff,
  renderDuplicates,
  renderModules,
  renderPackages,
  renderSummary,
  renderWhy,
  table,
} from "./report.js";

export type { Io } from "./cli.js";
export { main, parseCommandLine } from "./cli.js";
export { VERSION } from "./version.js";
