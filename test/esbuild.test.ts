/** The esbuild metafile loader, against committed metafiles and hand-built bad ones. */

import { describe, expect, it } from "vitest";

import { fromEsbuildMetafile, looksLikeEsbuildMetafile } from "../src/esbuild.js";
import { MetafileError } from "../src/errors.js";
import { beforeBundle, fixtureJson, fixtureText } from "./helpers.js";
import { loadBundle } from "../src/load.js";

describe("looksLikeEsbuildMetafile", () => {
  it("accepts an object with both required keys", () => {
    expect(looksLikeEsbuildMetafile({ inputs: {}, outputs: {} })).toBe(true);
  });

  it("rejects an object with only one of them", () => {
    expect(looksLikeEsbuildMetafile({ inputs: {} })).toBe(false);
    expect(looksLikeEsbuildMetafile({ outputs: {} })).toBe(false);
  });

  it("rejects arrays, null and primitives without throwing", () => {
    expect(looksLikeEsbuildMetafile([])).toBe(false);
    expect(looksLikeEsbuildMetafile(null)).toBe(false);
    expect(looksLikeEsbuildMetafile("inputs outputs")).toBe(false);
  });

  it("accepts the real fixture", () => {
    expect(looksLikeEsbuildMetafile(fixtureJson("esbuild", "app-before.json"))).toBe(true);
  });
});

describe("loading the app fixture", () => {
  const bundle = beforeBundle();

  it("records the format and the label", () => {
    expect(bundle.format).toBe("esbuild");
    expect(bundle.label).toBe("app-before.json");
  });

  it("loads every input as a module", () => {
    expect(bundle.modules.size).toBe(12);
    expect(bundle.modules.has("node_modules/left-pad/index.js")).toBe(true);
  });

  it("keeps source bytes separate from output contribution", () => {
    expect(bundle.modules.get("src/app.tsx")?.bytes).toBe(2048);
    expect(bundle.outputs.get("dist/app.js")?.contributions.get("src/app.tsx")).toBe(1500);
  });

  it("preserves import kinds", () => {
    const react = bundle.modules.get("node_modules/react/index.js");
    expect(react?.imports[0]?.kind).toBe("require-call");
    expect(bundle.modules.get("src/index.ts")?.imports[0]?.kind).toBe("import-statement");
  });

  it("preserves the specifier as written", () => {
    expect(bundle.modules.get("src/index.ts")?.imports[0]?.original).toBe("./app");
  });

  it("defaults external to false and honours it when present", () => {
    const imports = bundle.modules.get("src/index.ts")?.imports ?? [];
    expect(imports.find((i) => i.path === "src/app.tsx")?.external).toBe(false);
    expect(imports.find((i) => i.path === "node:fs")?.external).toBe(true);
  });

  it("keeps edges to modules absent from inputs, because those are externals", () => {
    expect(bundle.modules.has("node:fs")).toBe(false);
    expect(
      bundle.modules.get("src/index.ts")?.imports.some((i) => i.path === "node:fs"),
    ).toBe(true);
  });

  it("reads the module format when the bundler reported one", () => {
    expect(bundle.modules.get("node_modules/react/index.js")?.format).toBe("cjs");
    expect(bundle.modules.get("src/index.ts")?.format).toBe("esm");
  });

  it("loads outputs with their entry points and sizes", () => {
    expect(bundle.outputs.size).toBe(2);
    expect(bundle.outputs.get("dist/app.js")?.bytes).toBe(67700);
    expect(bundle.outputs.get("dist/app.js")?.entryPoint).toBe("src/index.ts");
  });

  it("reports no entry point for a shared chunk", () => {
    const cyclic = loadBundle(fixtureText("esbuild", "cyclic.json"), "cyclic.json");
    expect(cyclic.outputs.get("dist/chunk-SHARED.js")?.entryPoint).toBeUndefined();
  });

  it("sums each output's contributions to its declared size", () => {
    for (const output of bundle.outputs.values()) {
      const sum = [...output.contributions.values()].reduce((a, b) => a + b, 0);
      expect(sum).toBe(output.bytes);
    }
  });
});

describe("tolerating what changes between bundler releases", () => {
  it("collapses an unfamiliar import kind to unknown instead of failing", () => {
    const bundle = fromEsbuildMetafile(
      {
        inputs: { "a.js": { bytes: 1, imports: [{ path: "b.js", kind: "brand-new-kind" }] } },
        outputs: {},
      },
      "x",
    );
    expect(bundle.modules.get("a.js")?.imports[0]?.kind).toBe("unknown");
  });

  it("treats a missing kind as unknown", () => {
    const bundle = fromEsbuildMetafile(
      { inputs: { "a.js": { bytes: 1, imports: [{ path: "b.js" }] } }, outputs: {} },
      "x",
    );
    expect(bundle.modules.get("a.js")?.imports[0]?.kind).toBe("unknown");
  });

  it("treats a missing imports array as no imports", () => {
    const bundle = fromEsbuildMetafile({ inputs: { "a.js": { bytes: 1 } }, outputs: {} }, "x");
    expect(bundle.modules.get("a.js")?.imports).toEqual([]);
  });

  it("treats missing output inputs as no contributions", () => {
    const bundle = fromEsbuildMetafile(
      { inputs: {}, outputs: { "o.js": { bytes: 0 } } },
      "x",
    );
    expect(bundle.outputs.get("o.js")?.contributions.size).toBe(0);
  });

  it("accepts an entirely empty metafile", () => {
    const bundle = fromEsbuildMetafile({ inputs: {}, outputs: {} }, "x");
    expect(bundle.modules.size).toBe(0);
    expect(bundle.outputs.size).toBe(0);
  });
});

describe("rejecting malformed metafiles", () => {
  const load = (name: string): unknown => fixtureJson("malformed", name);

  it("names the input whose size is not a number", () => {
    expect(() => fromEsbuildMetafile(load("bad-bytes.json"), "x")).toThrow(
      'inputs["src/index.ts"].bytes must be a non-negative number, found a string',
    );
  });

  it("names the input whose size is negative", () => {
    expect(() => fromEsbuildMetafile(load("negative-bytes.json"), "x")).toThrow(
      'inputs["src/index.ts"].bytes must be a non-negative number, found -5',
    );
  });

  it("names the input whose imports are not an array", () => {
    expect(() => fromEsbuildMetafile(load("imports-not-array.json"), "x")).toThrow(
      'inputs["src/index.ts"].imports must be an array',
    );
  });

  it("names the output that is missing its size", () => {
    expect(() => fromEsbuildMetafile(load("output-missing-bytes.json"), "x")).toThrow(
      'outputs["dist/app.js"].bytes must be a non-negative number',
    );
  });

  it("rejects a top-level array", () => {
    expect(() => fromEsbuildMetafile([], "x")).toThrow("metafile must be an object, found an array");
  });

  it("rejects inputs that are not an object", () => {
    expect(() => fromEsbuildMetafile({ inputs: [], outputs: {} }, "x")).toThrow(
      "inputs must be an object",
    );
  });

  it("rejects outputs that are not an object", () => {
    expect(() => fromEsbuildMetafile({ inputs: {}, outputs: 1 }, "x")).toThrow(
      "outputs must be an object",
    );
  });

  it("indexes into the offending import", () => {
    expect(() =>
      fromEsbuildMetafile(
        { inputs: { "a.js": { bytes: 1, imports: [{ path: "b" }, { kind: "x" }] } }, outputs: {} },
        "x",
      ),
    ).toThrow('inputs["a.js"].imports[1].path must be a string');
  });

  it("rejects a non-object import entry", () => {
    expect(() =>
      fromEsbuildMetafile(
        { inputs: { "a.js": { bytes: 1, imports: ["b.js"] } }, outputs: {} },
        "x",
      ),
    ).toThrow('inputs["a.js"].imports[0] must be an object');
  });

  it("rejects a bad bytesInOutput", () => {
    expect(() =>
      fromEsbuildMetafile(
        { inputs: {}, outputs: { "o.js": { bytes: 1, inputs: { "a.js": { bytesInOutput: null } } } } },
        "x",
      ),
    ).toThrow('outputs["o.js"].inputs["a.js"].bytesInOutput must be a non-negative number');
  });

  it("throws MetafileError, never a bare TypeError", () => {
    expect(() => fromEsbuildMetafile({ inputs: null, outputs: {} }, "x")).toThrow(MetafileError);
  });
});
