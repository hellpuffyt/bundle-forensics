/**
 * Loader for esbuild metafiles (`esbuild --metafile=meta.json`).
 *
 * The metafile is the cleanest bundle description any bundler emits: it
 * gives the real post-tree-shaking byte contribution of every module to
 * every output (`outputs[o].inputs[i].bytesInOutput`), which is exactly
 * the number people think they are reading when they look at a treemap.
 *
 * The shape, abbreviated:
 *
 * ```json
 * {
 *   "inputs": {
 *     "src/app.ts": {
 *       "bytes": 2048,
 *       "imports": [{ "path": "src/log.ts", "kind": "import-statement" }]
 *     }
 *   },
 *   "outputs": {
 *     "dist/app.js": {
 *       "bytes": 67700,
 *       "entryPoint": "src/index.ts",
 *       "inputs": { "src/app.ts": { "bytesInOutput": 1500 } }
 *     }
 *   }
 * }
 * ```
 *
 * Two normalisations happen here and nowhere else. Unknown `kind`
 * strings collapse to `"unknown"` rather than being rejected, because
 * esbuild adds new kinds in minor releases and a stats reader that
 * breaks on a bundler upgrade is worse than useless. And imports
 * pointing at modules absent from `inputs` are kept — they are usually
 * externals, and dropping the edge would silently break a `why` chain.
 */

import type { Bundle, ImportKind, Module, ModuleImport, Output } from "./model.js";
import {
  asArray,
  asBytes,
  asObject,
  asString,
  optionalBoolean,
  optionalString,
} from "./validate.js";

const KNOWN_KINDS: ReadonlySet<string> = new Set<ImportKind>([
  "entry-point",
  "import-statement",
  "require-call",
  "dynamic-import",
  "require-resolve",
  "import-rule",
  "composes-from",
  "url-token",
]);

function toKind(value: unknown, where: string): ImportKind {
  if (value === undefined) return "unknown";
  const text = asString(value, where);
  return KNOWN_KINDS.has(text) ? (text as ImportKind) : "unknown";
}

/** True if `value` has the two top-level keys an esbuild metafile must have. */
export function looksLikeEsbuildMetafile(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return "inputs" in record && "outputs" in record;
}

function readImports(value: unknown, where: string): ModuleImport[] {
  if (value === undefined) return [];
  const raw = asArray(value, where);
  return raw.map((entry, index) => {
    const at = `${where}[${index}]`;
    const record = asObject(entry, at);
    const original = optionalString(record["original"], `${at}.original`);
    const item: ModuleImport = {
      path: asString(record["path"], `${at}.path`),
      kind: toKind(record["kind"], `${at}.kind`),
      external: optionalBoolean(record["external"], `${at}.external`, false),
      ...(original === undefined ? {} : { original }),
    };
    return item;
  });
}

function readModules(value: unknown): Map<string, Module> {
  const inputs = asObject(value, "inputs");
  const modules = new Map<string, Module>();
  for (const [path, entry] of Object.entries(inputs)) {
    const at = `inputs[${JSON.stringify(path)}]`;
    const record = asObject(entry, at);
    const format = optionalString(record["format"], `${at}.format`);
    modules.set(path, {
      path,
      bytes: asBytes(record["bytes"], `${at}.bytes`),
      imports: readImports(record["imports"], `${at}.imports`),
      ...(format === undefined ? {} : { format }),
    });
  }
  return modules;
}

function readContributions(value: unknown, where: string): Map<string, number> {
  const contributions = new Map<string, number>();
  if (value === undefined) return contributions;
  const record = asObject(value, where);
  for (const [path, entry] of Object.entries(record)) {
    const at = `${where}[${JSON.stringify(path)}]`;
    const inner = asObject(entry, at);
    contributions.set(path, asBytes(inner["bytesInOutput"], `${at}.bytesInOutput`));
  }
  return contributions;
}

function readOutputs(value: unknown): Map<string, Output> {
  const outputs = asObject(value, "outputs");
  const result = new Map<string, Output>();
  for (const [path, entry] of Object.entries(outputs)) {
    const at = `outputs[${JSON.stringify(path)}]`;
    const record = asObject(entry, at);
    const entryPoint = optionalString(record["entryPoint"], `${at}.entryPoint`);
    result.set(path, {
      path,
      bytes: asBytes(record["bytes"], `${at}.bytes`),
      contributions: readContributions(record["inputs"], `${at}.inputs`),
      ...(entryPoint === undefined ? {} : { entryPoint }),
    });
  }
  return result;
}

/** Converts a parsed esbuild metafile into the normalised model. */
export function fromEsbuildMetafile(value: unknown, label: string): Bundle {
  const root = asObject(value, "metafile");
  return {
    format: "esbuild",
    label,
    modules: readModules(root["inputs"]),
    outputs: readOutputs(root["outputs"]),
  };
}
