/** Shared fixture plumbing. Not a test file — `vitest` only collects `*.test.ts`. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadBundle } from "../src/load.js";
import type { Bundle } from "../src/model.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to a file under `fixtures/`. */
export function fixturePath(...parts: string[]): string {
  return join(here, "..", "fixtures", ...parts);
}

/** Raw text of a fixture. */
export function fixtureText(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), "utf8");
}

/** A fixture parsed as JSON, for tests that poke at the raw shape. */
export function fixtureJson(...parts: string[]): unknown {
  return JSON.parse(fixtureText(...parts)) as unknown;
}

/** A fixture loaded into the normalised model, labelled by its file name. */
export function fixtureBundle(...parts: string[]): Bundle {
  const label = parts[parts.length - 1] ?? "fixture";
  return loadBundle(fixtureText(...parts), label);
}

/** The primary esbuild fixture: a two-entry app with a duplicated dependency. */
export function beforeBundle(): Bundle {
  return fixtureBundle("esbuild", "app-before.json");
}

/** The same app one commit later: a dependency swapped, a duplicate resolved. */
export function afterBundle(): Bundle {
  return fixtureBundle("esbuild", "app-after.json");
}

/** Captured CLI output. */
export interface Captured {
  readonly out: string;
  readonly err: string;
}

/** An `Io` that accumulates into strings, plus the strings it writes into. */
export function capture(): {
  io: { stdout(text: string): void; stderr(text: string): void };
  read(): Captured;
} {
  let out = "";
  let err = "";
  return {
    io: {
      stdout(text: string) {
        out += text;
      },
      stderr(text: string) {
        err += text;
      },
    },
    read: () => ({ out, err }),
  };
}
