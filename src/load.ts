/**
 * Choosing a loader.
 *
 * Nobody remembers whether the artefact CI uploaded was a metafile or a
 * stats dump, so the format is sniffed from the top-level keys rather
 * than from a flag. The sniff is deliberately narrow — two key names —
 * and a file matching neither is rejected with a message that says what
 * it looked at, instead of being half-parsed into an empty report.
 */

import { fromEsbuildMetafile, looksLikeEsbuildMetafile } from "./esbuild.js";
import { MetafileError } from "./errors.js";
import type { Bundle } from "./model.js";
import { parseJson } from "./validate.js";
import { fromWebpackStats, looksLikeWebpackStats } from "./webpack.js";

/** Which loader a parsed JSON value would be handed to, if any. */
export function detectFormat(value: unknown): Bundle["format"] | undefined {
  if (looksLikeEsbuildMetafile(value)) return "esbuild";
  if (looksLikeWebpackStats(value)) return "webpack";
  return undefined;
}

/** Normalises an already-parsed stats value, sniffing its format. */
export function fromJson(value: unknown, label: string): Bundle {
  switch (detectFormat(value)) {
    case "esbuild":
      return fromEsbuildMetafile(value, label);
    case "webpack":
      return fromWebpackStats(value, label);
    default:
      throw new MetafileError(
        `${label} is not a recognised bundle stats file: expected an esbuild ` +
          `metafile (top-level "inputs" and "outputs") or webpack stats ` +
          `(a top-level "modules" array)`,
      );
  }
}

/** Parses stats JSON text and normalises it. `label` names it in errors. */
export function loadBundle(text: string, label: string): Bundle {
  return fromJson(parseJson(text, label), label);
}
