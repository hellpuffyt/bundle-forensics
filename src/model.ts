/**
 * The normalised bundle model.
 *
 * Every supported stats format is converted into exactly this shape
 * before any analysis happens, which is why the analysis modules never
 * mention esbuild or webpack. Adding a third bundler means writing one
 * more loader, not touching `graph.ts`, `packages.ts` or `diff.ts`.
 *
 * Two things are deliberately kept apart:
 *
 * - a module's **source size** (`Module.bytes`) is how big the file was
 *   on disk before bundling;
 * - a module's **contribution** (`Output.contributions`) is how many
 *   bytes of a particular output file came from it, after tree shaking
 *   and minification.
 *
 * Only the second one answers "why is my bundle this big", so it is the
 * number every report defaults to. Conflating the two is the single most
 * common way bundle analysis lies to you.
 */

/** How one module reached another. Mirrors esbuild's `kind` vocabulary. */
export type ImportKind =
  | "entry-point"
  | "import-statement"
  | "require-call"
  | "dynamic-import"
  | "require-resolve"
  | "import-rule"
  | "composes-from"
  | "url-token"
  | "unknown";

/** One edge of the module graph. */
export interface ModuleImport {
  /** The resolved path of the imported module. */
  readonly path: string;
  readonly kind: ImportKind;
  /** True when the bundler left the import alone (`node:fs`, peer deps). */
  readonly external: boolean;
  /** The specifier as written in the source, when the bundler recorded it. */
  readonly original?: string;
}

/** One module in the graph, keyed by its bundler-resolved path. */
export interface Module {
  readonly path: string;
  /** Source bytes before bundling. */
  readonly bytes: number;
  /** Module format, when the bundler reported one (`esm`, `cjs`). */
  readonly format?: string;
  readonly imports: readonly ModuleImport[];
}

/** One emitted file. */
export interface Output {
  readonly path: string;
  /** Size of the emitted file. */
  readonly bytes: number;
  /** The module this output was built for, if it is an entry chunk. */
  readonly entryPoint?: string;
  /** Bytes of this output contributed by each module, after tree shaking. */
  readonly contributions: ReadonlyMap<string, number>;
}

/** A whole build, normalised. */
export interface Bundle {
  /** Which loader produced this, for reports and for honest caveats. */
  readonly format: "esbuild" | "webpack";
  /** A label for reports — usually the file the stats were read from. */
  readonly label: string;
  readonly modules: ReadonlyMap<string, Module>;
  readonly outputs: ReadonlyMap<string, Output>;
}

/** Total emitted bytes across every output (or one named output). */
export function totalBytes(bundle: Bundle, output?: string): number {
  if (output === undefined) {
    let sum = 0;
    for (const out of bundle.outputs.values()) sum += out.bytes;
    return sum;
  }
  return bundle.outputs.get(output)?.bytes ?? 0;
}

/**
 * Bytes each module contributed, summed across the selected outputs.
 *
 * Restricting to one output is what makes per-chunk questions ("what is
 * in `vendor.js`?") answerable; without a filter a module that lands in
 * three chunks is counted three times, which is correct — it really was
 * shipped three times.
 */
export function contributionsByModule(
  bundle: Bundle,
  output?: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const out of bundle.outputs.values()) {
    if (output !== undefined && out.path !== output) continue;
    for (const [path, bytes] of out.contributions) {
      totals.set(path, (totals.get(path) ?? 0) + bytes);
    }
  }
  return totals;
}

/** Every entry point in the bundle, sorted, deduplicated. */
export function entryPoints(bundle: Bundle): string[] {
  const seen = new Set<string>();
  for (const out of bundle.outputs.values()) {
    if (out.entryPoint !== undefined) seen.add(out.entryPoint);
  }
  return [...seen].sort();
}
