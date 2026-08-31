/**
 * Loader for webpack stats JSON (`webpack --json > stats.json`).
 *
 * webpack describes the graph backwards from esbuild: instead of each
 * module listing what it imports, each module lists its `reasons` — the
 * modules that caused it to be included. That is a strictly richer
 * record of *why* something is in the bundle, so the loader simply
 * inverts it into the forward edges the rest of the tool expects.
 *
 * Two honest caveats, repeated in the README because they change what
 * the numbers mean:
 *
 * 1. **Sizes are pre-minification.** A webpack stats module reports its
 *    parsed source size, not its share of the emitted asset. There is no
 *    equivalent of esbuild's `bytesInOutput`, so a module's contribution
 *    to an asset is recorded as its source size. Rankings stay useful;
 *    the absolute totals will not match the file on disk.
 * 2. **Concatenated modules are not unpacked.** Scope hoisting collapses
 *    several source files into one stats module; the nested `modules`
 *    array is ignored and the group is reported under its own name.
 *
 * esbuild metafiles have neither problem, which is why they are the
 * primary target.
 */

import { MetafileError } from "./errors.js";
import type { Bundle, ImportKind, Module, ModuleImport, Output } from "./model.js";
import {
  asArray,
  asBytes,
  asObject,
  asString,
  optionalString,
  type JsonObject,
} from "./validate.js";

/** True if `value` has the top-level `modules` array webpack stats carry. */
export function looksLikeWebpackStats(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Array.isArray((value as Record<string, unknown>)["modules"]);
}

/**
 * Maps a webpack dependency type onto our vocabulary.
 *
 * The strings are prose ("harmony side effect evaluation", "cjs require")
 * and vary by version, so this matches on substrings and falls back to
 * `unknown` rather than pretending to know.
 */
export function reasonKind(type: string | undefined): ImportKind {
  if (type === undefined) return "unknown";
  const lower = type.toLowerCase();
  if (lower.includes("import()")) return "dynamic-import";
  if (lower.includes("entry")) return "entry-point";
  if (lower.includes("require")) return "require-call";
  if (lower.includes("harmony") || lower.includes("esm")) return "import-statement";
  return "unknown";
}

/** Chunk ids are numbers or strings depending on webpack config. */
function chunkId(value: unknown, where: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value, where);
}

function chunkIds(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  return asArray(value, where).map((id, i) => chunkId(id, `${where}[${i}]`));
}

interface RawModule {
  readonly path: string;
  readonly bytes: number;
  readonly chunks: readonly string[];
  readonly isEntry: boolean;
}

function moduleName(record: JsonObject, at: string): string {
  const name = optionalString(record["name"], `${at}.name`);
  if (name !== undefined && name !== "") return name;
  const identifier = optionalString(record["identifier"], `${at}.identifier`);
  if (identifier !== undefined && identifier !== "") return identifier;
  throw new MetafileError(`${at} must have a non-empty "name" or "identifier"`);
}

function readModules(value: unknown): {
  modules: Map<string, Module>;
  raw: RawModule[];
} {
  const list = asArray(value, "modules");
  const edges = new Map<string, ModuleImport[]>();
  const raw: RawModule[] = [];
  const external = new Set<string>();

  // First pass: identify every module, and invert its reasons into edges.
  for (const [index, entry] of list.entries()) {
    const at = `modules[${index}]`;
    const record = asObject(entry, at);
    const path = moduleName(record, at);
    const bytes = asBytes(record["size"], `${at}.size`);
    const chunks = chunkIds(record["chunks"], `${at}.chunks`);
    if (path.startsWith("external ")) external.add(path);

    const reasons = record["reasons"] === undefined ? [] : asArray(record["reasons"], `${at}.reasons`);
    let isEntry = reasons.length === 0;
    for (const [j, reasonEntry] of reasons.entries()) {
      const reasonAt = `${at}.reasons[${j}]`;
      const reason = asObject(reasonEntry, reasonAt);
      const from = optionalString(reason["moduleName"], `${reasonAt}.moduleName`);
      const type = optionalString(reason["type"], `${reasonAt}.type`);
      if (from === undefined || from === "") {
        isEntry = true;
        continue;
      }
      const original = optionalString(reason["userRequest"], `${reasonAt}.userRequest`);
      const list_ = edges.get(from) ?? [];
      list_.push({
        path,
        kind: reasonKind(type),
        external: false,
        ...(original === undefined ? {} : { original }),
      });
      edges.set(from, list_);
    }
    raw.push({ path, bytes, chunks, isEntry });
  }

  const modules = new Map<string, Module>();
  for (const item of raw) {
    const imports = (edges.get(item.path) ?? []).map((edge) =>
      external.has(edge.path) ? { ...edge, external: true } : edge,
    );
    modules.set(item.path, { path: item.path, bytes: item.bytes, imports });
  }
  return { modules, raw };
}

function readOutputs(
  value: unknown,
  chunkEntries: ReadonlySet<string>,
  raw: readonly RawModule[],
): Map<string, Output> {
  const outputs = new Map<string, Output>();
  if (value === undefined) return outputs;
  const list = asArray(value, "assets");
  for (const [index, entry] of list.entries()) {
    const at = `assets[${index}]`;
    const record = asObject(entry, at);
    const path = asString(record["name"], `${at}.name`);
    const bytes = asBytes(record["size"], `${at}.size`);
    const chunks = new Set(chunkIds(record["chunks"], `${at}.chunks`));

    const contributions = new Map<string, number>();
    const entryCandidates: string[] = [];
    for (const item of raw) {
      if (!item.chunks.some((id) => chunks.has(id))) continue;
      contributions.set(item.path, (contributions.get(item.path) ?? 0) + item.bytes);
      if (item.isEntry && item.chunks.some((id) => chunkEntries.has(id))) {
        entryCandidates.push(item.path);
      }
    }
    entryCandidates.sort();
    const entryPoint = entryCandidates[0];
    outputs.set(path, {
      path,
      bytes,
      contributions,
      ...(entryPoint === undefined ? {} : { entryPoint }),
    });
  }
  return outputs;
}

function readEntryChunks(value: unknown): Set<string> {
  const entries = new Set<string>();
  if (value === undefined) return entries;
  const list = asArray(value, "chunks");
  for (const [index, entry] of list.entries()) {
    const at = `chunks[${index}]`;
    const record = asObject(entry, at);
    if (record["entry"] === true) entries.add(chunkId(record["id"], `${at}.id`));
  }
  return entries;
}

/** Converts parsed webpack stats JSON into the normalised model. */
export function fromWebpackStats(value: unknown, label: string): Bundle {
  const root = asObject(value, "stats");
  const { modules, raw } = readModules(root["modules"]);
  const entryChunks = readEntryChunks(root["chunks"]);
  return {
    format: "webpack",
    label,
    modules,
    outputs: readOutputs(root["assets"], entryChunks, raw),
  };
}
