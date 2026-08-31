/** Format sniffing and the model helpers built on top of it. */

import { describe, expect, it } from "vitest";

import { MetafileError } from "../src/errors.js";
import { detectFormat, fromJson, loadBundle } from "../src/load.js";
import { contributionsByModule, entryPoints, totalBytes } from "../src/model.js";
import { beforeBundle, fixtureBundle, fixtureText } from "./helpers.js";

describe("detectFormat", () => {
  it("recognises an esbuild metafile", () => {
    expect(detectFormat({ inputs: {}, outputs: {} })).toBe("esbuild");
  });

  it("recognises webpack stats", () => {
    expect(detectFormat({ modules: [] })).toBe("webpack");
  });

  it("prefers esbuild when a file somehow looks like both", () => {
    expect(detectFormat({ inputs: {}, outputs: {}, modules: [] })).toBe("esbuild");
  });

  it("returns undefined for anything else", () => {
    expect(detectFormat({ hello: "world" })).toBeUndefined();
    expect(detectFormat([])).toBeUndefined();
    expect(detectFormat(null)).toBeUndefined();
  });
});

describe("loadBundle", () => {
  it("loads an esbuild metafile from text", () => {
    expect(loadBundle(fixtureText("esbuild", "app-before.json"), "a").format).toBe("esbuild");
  });

  it("loads webpack stats from text", () => {
    expect(loadBundle(fixtureText("webpack", "app-stats.json"), "a").format).toBe("webpack");
  });

  it("uses the label given to it, since that is what errors print", () => {
    expect(loadBundle('{"inputs":{},"outputs":{}}', "build/meta.json").label).toBe("build/meta.json");
  });

  it("reports invalid JSON with the label", () => {
    expect(() => loadBundle(fixtureText("malformed", "not-json.txt"), "not-json.txt")).toThrow(
      /^not-json\.txt is not valid JSON/,
    );
  });

  it("rejects an unrecognised shape with advice on what it wanted", () => {
    expect(() => loadBundle(fixtureText("malformed", "unknown-shape.json"), "u.json")).toThrow(
      /u\.json is not a recognised bundle stats file/,
    );
    expect(() => loadBundle(fixtureText("malformed", "unknown-shape.json"), "u.json")).toThrow(
      /esbuild metafile.*webpack stats/s,
    );
  });

  it("rejects a top-level array", () => {
    expect(() => loadBundle(fixtureText("malformed", "top-level-array.json"), "a.json")).toThrow(
      MetafileError,
    );
  });

  it("rejects a JSON scalar", () => {
    expect(() => fromJson(42, "x")).toThrow(MetafileError);
  });
});

describe("model helpers", () => {
  const bundle = beforeBundle();

  it("totals every output by default", () => {
    expect(totalBytes(bundle)).toBe(69450);
  });

  it("totals one named output when asked", () => {
    expect(totalBytes(bundle, "dist/app.js")).toBe(67700);
  });

  it("totals zero for an output that does not exist", () => {
    expect(totalBytes(bundle, "dist/nope.js")).toBe(0);
  });

  it("sums a module's contribution across outputs", () => {
    // tiny-date lands in both chunks, at 1300 bytes each time.
    expect(contributionsByModule(bundle).get("node_modules/tiny-date/index.js")).toBe(2600);
  });

  it("restricts contributions to one output", () => {
    const inWorker = contributionsByModule(bundle, "dist/worker.js");
    expect(inWorker.get("node_modules/tiny-date/index.js")).toBe(1300);
    expect(inWorker.has("node_modules/react/index.js")).toBe(false);
  });

  it("sums contributions to the same total as the outputs", () => {
    const sum = [...contributionsByModule(bundle).values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(totalBytes(bundle));
  });

  it("lists entry points sorted and deduplicated", () => {
    expect(entryPoints(bundle)).toEqual(["src/index.ts", "src/worker.ts"]);
  });

  it("returns no entry points for a bundle that declares none", () => {
    expect(entryPoints(fixtureBundle("esbuild", "empty.json"))).toEqual([]);
  });
});
