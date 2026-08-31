/**
 * Walking the module graph: who pulled this in, and by what route.
 *
 * The question a bundle analyser actually has to answer is not "how big
 * is `left-pad`" but "why is `left-pad` here at all". That is a shortest
 * path from an entry point, so the search is a breadth-first one: the
 * first route found is the shortest, which is the one worth reading. A
 * depth-first walk would happily report a twelve-hop path through a
 * barrel file when a two-hop one exists.
 *
 * Cycles are normal in real graphs (barrel files re-export each other),
 * so every traversal here is `visited`-guarded and terminates.
 */

import { QueryError } from "./errors.js";
import type { Bundle, ImportKind } from "./model.js";
import { entryPoints } from "./model.js";
import { packageOf } from "./packages.js";

/** One hop of an import chain. */
export interface Link {
  readonly from: string;
  readonly to: string;
  readonly kind: ImportKind;
  /** The specifier as written, when the bundler recorded it. */
  readonly original?: string;
}

/** A shortest route from one entry point to a module. */
export interface Chain {
  readonly entry: string;
  /** Empty when the module *is* the entry point. */
  readonly links: readonly Link[];
}

/** Direct importers of `modulePath`, sorted. */
export function importedBy(bundle: Bundle, modulePath: string): Link[] {
  const links: Link[] = [];
  for (const module of bundle.modules.values()) {
    for (const edge of module.imports) {
      if (edge.path !== modulePath) continue;
      links.push({
        from: module.path,
        to: edge.path,
        kind: edge.kind,
        ...(edge.original === undefined ? {} : { original: edge.original }),
      });
    }
  }
  links.sort((a, b) => a.from.localeCompare(b.from) || a.kind.localeCompare(b.kind));
  return links;
}

/** Modules `modulePath` imports directly, sorted. */
export function imports(bundle: Bundle, modulePath: string): Link[] {
  const module = bundle.modules.get(modulePath);
  if (module === undefined) return [];
  return module.imports
    .map((edge) => ({
      from: modulePath,
      to: edge.path,
      kind: edge.kind,
      ...(edge.original === undefined ? {} : { original: edge.original }),
    }))
    .sort((a, b) => a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
}

/**
 * Shortest import chain from `entry` to `target`, or `undefined`.
 *
 * Breadth-first, so the returned chain is minimal in hops. Ties are
 * broken by the order the bundler recorded the imports, which is source
 * order — the route a human would trace by reading the file top to
 * bottom.
 */
export function shortestChain(
  bundle: Bundle,
  entry: string,
  target: string,
): Chain | undefined {
  if (entry === target) return { entry, links: [] };

  const cameFrom = new Map<string, Link>();
  const seen = new Set<string>([entry]);
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const module = bundle.modules.get(current);
    if (module === undefined) continue;
    for (const edge of module.imports) {
      if (seen.has(edge.path)) continue;
      seen.add(edge.path);
      cameFrom.set(edge.path, {
        from: current,
        to: edge.path,
        kind: edge.kind,
        ...(edge.original === undefined ? {} : { original: edge.original }),
      });
      if (edge.path === target) {
        const links: Link[] = [];
        for (let at = target; ; ) {
          const link = cameFrom.get(at);
          if (link === undefined) break;
          links.unshift(link);
          at = link.from;
        }
        return { entry, links };
      }
      queue.push(edge.path);
    }
  }
  return undefined;
}

/**
 * One shortest chain per entry point that can reach `target`.
 *
 * An empty result means the module is in the stats file but no entry
 * point reaches it — dead weight the bundler kept, or a graph the stats
 * file only partly describes.
 */
export function whyIncluded(bundle: Bundle, target: string): Chain[] {
  const chains: Chain[] = [];
  for (const entry of entryPoints(bundle)) {
    const chain = shortestChain(bundle, entry, target);
    if (chain !== undefined) chains.push(chain);
  }
  return chains;
}

/** Every module reachable from `entry`, including `entry` itself. */
export function reachableFrom(bundle: Bundle, entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of bundle.modules.get(current)?.imports ?? []) {
      if (seen.has(edge.path)) continue;
      seen.add(edge.path);
      queue.push(edge.path);
    }
  }
  return seen;
}

/**
 * Modules in the stats file that no entry point reaches.
 *
 * With a well-formed metafile this is empty. When it is not, either the
 * stats file was assembled from several builds or the bundler kept
 * something it never needed — both worth knowing.
 */
export function orphanModules(bundle: Bundle): string[] {
  const reached = new Set<string>();
  for (const entry of entryPoints(bundle)) {
    for (const path of reachableFrom(bundle, entry)) reached.add(path);
  }
  return [...bundle.modules.keys()].filter((path) => !reached.has(path)).sort();
}

function suggestionsFor(bundle: Bundle, query: string): string[] {
  const needle = query.toLowerCase();
  const head = needle.split(/[/\\]/).pop() ?? needle;
  const hits = [...bundle.modules.keys()].filter((path) =>
    path.toLowerCase().includes(head),
  );
  return hits.sort().slice(0, 5);
}

/**
 * Turns a user-typed module query into concrete module paths.
 *
 * Resolution is layered so the obvious thing wins: an exact path, then a
 * package name (`react` means all of react's files), then a path suffix
 * (`util/log.ts`), then a substring. Each layer is tried only if the
 * previous found nothing, which keeps `react` from also dragging in
 * `react-dom` via substring matching.
 */
export function resolveModules(bundle: Bundle, query: string): string[] {
  if (query === "") throw new QueryError("module query must not be empty");
  const paths = [...bundle.modules.keys()];

  if (bundle.modules.has(query)) return [query];

  const byPackage = paths.filter((path) => packageOf(path) === query);
  if (byPackage.length > 0) return byPackage.sort();

  const needle = query.replaceAll("\\", "/");
  const bySuffix = paths.filter((path) => path.replaceAll("\\", "/").endsWith(needle));
  if (bySuffix.length > 0) return bySuffix.sort();

  const bySubstring = paths.filter((path) =>
    path.replaceAll("\\", "/").includes(needle),
  );
  if (bySubstring.length > 0) return bySubstring.sort();

  throw new QueryError(
    `no module matching ${JSON.stringify(query)} in ${bundle.label}`,
    suggestionsFor(bundle, query),
  );
}

/** Resolves a query that must name exactly one module. */
export function resolveOneModule(bundle: Bundle, query: string): string {
  const matches = resolveModules(bundle, query);
  const only = matches[0];
  if (matches.length > 1 || only === undefined) {
    throw new QueryError(
      `${JSON.stringify(query)} matches ${matches.length} modules; be more specific`,
      matches.slice(0, 5),
    );
  }
  return only;
}
