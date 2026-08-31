/**
 * Promises the packaging makes, checked rather than trusted.
 *
 * "Zero runtime dependencies" and "the version constant is the published
 * version" are both claims in the README. A claim nobody checks is a
 * claim that will eventually be false, so both are checked here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as api from "../src/index.js";
import { VERSION } from "../src/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
  dependencies?: Record<string, string>;
  engines: { node: string };
  bin: Record<string, string>;
  type: string;
};

describe("package.json", () => {
  it("has no runtime dependencies", () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it("keeps VERSION in step with the published version", () => {
    expect(VERSION).toBe(manifest.version);
  });

  it("declares the Node floor the code assumes", () => {
    expect(manifest.engines.node).toBe(">=20");
  });

  it("ships as ESM with one console entry point", () => {
    expect(manifest.type).toBe("module");
    expect(manifest.bin).toEqual({ "bundle-forensics": "bin/bundle-forensics.js" });
  });
});

describe("the bin stub", () => {
  const stub = readFileSync(join(root, "bin", "bundle-forensics.js"), "utf8");

  it("starts with a shebang", () => {
    expect(stub.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("delegates to the compiled CLI rather than reimplementing it", () => {
    expect(stub).toContain('from "../dist/cli.js"');
    expect(stub).toContain("main(process.argv.slice(2)");
  });
});

describe("the public API", () => {
  it("exports every analysis entry point the CLI uses", () => {
    for (const name of [
      "loadBundle",
      "diffBundles",
      "findDuplicates",
      "packageReport",
      "whyIncluded",
      "resolveModules",
      "main",
    ]) {
      expect(typeof (api as unknown as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("exports the error classes so callers can catch them precisely", () => {
    expect(new api.MetafileError("x")).toBeInstanceOf(Error);
    expect(new api.QueryError("x").name).toBe("QueryError");
    expect(api.isExpectedError(new api.QueryError("x"))).toBe(true);
    expect(api.isExpectedError(new TypeError("x"))).toBe(false);
  });

  it("carries suggestions on a QueryError, defaulting to none", () => {
    expect(new api.QueryError("x").suggestions).toEqual([]);
    expect(new api.QueryError("x", ["a"]).suggestions).toEqual(["a"]);
  });

  it("exports the version", () => {
    expect(api.VERSION).toBe(VERSION);
  });
});
