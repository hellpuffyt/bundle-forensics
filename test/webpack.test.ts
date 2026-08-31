/**
 * The webpack stats loader.
 *
 * The interesting part is the inversion: webpack records `reasons`
 * (who imported me), the model wants forward edges, and the tests below
 * check that the direction really did flip rather than being copied.
 */

import { describe, expect, it } from "vitest";

import { MetafileError } from "../src/errors.js";
import { fromWebpackStats, looksLikeWebpackStats, reasonKind } from "../src/webpack.js";
import { fixtureBundle, fixtureJson } from "./helpers.js";

const stats = (): unknown => fixtureJson("webpack", "app-stats.json");

describe("looksLikeWebpackStats", () => {
  it("accepts a top-level modules array", () => {
    expect(looksLikeWebpackStats({ modules: [] })).toBe(true);
  });

  it("rejects a modules key that is not an array", () => {
    expect(looksLikeWebpackStats({ modules: {} })).toBe(false);
  });

  it("rejects arrays, null and primitives", () => {
    expect(looksLikeWebpackStats([])).toBe(false);
    expect(looksLikeWebpackStats(null)).toBe(false);
    expect(looksLikeWebpackStats(7)).toBe(false);
  });
});

describe("reasonKind", () => {
  it("recognises dynamic imports", () => {
    expect(reasonKind("import() context element")).toBe("dynamic-import");
  });

  it("recognises entry reasons", () => {
    expect(reasonKind("single entry")).toBe("entry-point");
  });

  it("recognises CommonJS requires", () => {
    expect(reasonKind("cjs require")).toBe("require-call");
  });

  it("recognises harmony and esm imports", () => {
    expect(reasonKind("harmony side effect evaluation")).toBe("import-statement");
    expect(reasonKind("esm import")).toBe("import-statement");
  });

  it("is case-insensitive, because the strings are prose", () => {
    expect(reasonKind("CJS Require")).toBe("require-call");
  });

  it("prefers dynamic-import over the require it also mentions", () => {
    expect(reasonKind("import() require context")).toBe("dynamic-import");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(reasonKind("something new in webpack 7")).toBe("unknown");
    expect(reasonKind(undefined)).toBe("unknown");
  });
});

describe("loading the webpack fixture", () => {
  const bundle = fixtureBundle("webpack", "app-stats.json");

  it("is detected as webpack", () => {
    expect(bundle.format).toBe("webpack");
  });

  it("loads every module", () => {
    expect(bundle.modules.size).toBe(7);
  });

  it("falls back to the identifier when there is no name", () => {
    expect(bundle.modules.has('external "react"')).toBe(true);
  });

  it("inverts reasons into forward edges", () => {
    const index = bundle.modules.get("./src/index.js");
    expect(index?.imports.map((i) => i.path).sort()).toEqual([
      "./node_modules/tiny/index.js",
      "./src/app.js",
    ]);
  });

  it("gives an inverted edge the reason's dependency kind", () => {
    const app = bundle.modules.get("./src/app.js");
    expect(app?.imports.find((i) => i.path === "./src/lazy.js")?.kind).toBe("dynamic-import");
    expect(app?.imports.find((i) => i.path.includes("lodash"))?.kind).toBe("require-call");
  });

  it("carries the user request through as the written specifier", () => {
    const app = bundle.modules.get("./src/app.js");
    expect(app?.imports.find((i) => i.path.includes("lodash"))?.original).toBe("lodash");
  });

  it("marks edges into an external module as external", () => {
    const app = bundle.modules.get("./src/app.js");
    expect(app?.imports.find((i) => i.path === 'external "react"')?.external).toBe(true);
    expect(app?.imports.find((i) => i.path === "./src/lazy.js")?.external).toBe(false);
  });

  it("records a module reached from two places as two edges", () => {
    const lodash = "./node_modules/lodash/lodash.js";
    const from = [...bundle.modules.values()].filter((m) =>
      m.imports.some((i) => i.path === lodash),
    );
    expect(from.map((m) => m.path).sort()).toEqual(["./src/app.js", "./src/lazy.js"]);
  });

  it("maps assets to outputs with their chunk modules", () => {
    expect(bundle.outputs.get("main.js")?.bytes).toBe(74000);
    expect(bundle.outputs.get("main.js")?.contributions.size).toBe(5);
  });

  it("counts a module in two chunks against both assets", () => {
    const lodash = "./node_modules/lodash/lodash.js";
    expect(bundle.outputs.get("main.js")?.contributions.get(lodash)).toBe(72000);
    expect(bundle.outputs.get("vendors.js")?.contributions.get(lodash)).toBe(72000);
  });

  it("picks the entry module of an entry chunk as the entry point", () => {
    expect(bundle.outputs.get("main.js")?.entryPoint).toBe("./src/index.js");
  });

  it("leaves a non-entry chunk without an entry point", () => {
    expect(bundle.outputs.get("vendors.js")?.entryPoint).toBeUndefined();
  });
});

describe("webpack shapes that vary", () => {
  it("accepts string chunk ids as readily as numbers", () => {
    const bundle = fromWebpackStats(
      {
        modules: [{ name: "a", size: 1, chunks: ["main"] }],
        chunks: [{ id: "main", entry: true }],
        assets: [{ name: "main.js", size: 1, chunks: ["main"] }],
      },
      "x",
    );
    expect(bundle.outputs.get("main.js")?.entryPoint).toBe("a");
  });

  it("treats a module with no reasons at all as an entry module", () => {
    const bundle = fromWebpackStats(
      {
        modules: [{ name: "a", size: 1, chunks: [0] }],
        chunks: [{ id: 0, entry: true }],
        assets: [{ name: "main.js", size: 1, chunks: [0] }],
      },
      "x",
    );
    expect(bundle.outputs.get("main.js")?.entryPoint).toBe("a");
  });

  it("works with no assets and no chunks at all", () => {
    const bundle = fromWebpackStats({ modules: [{ name: "a", size: 1 }] }, "x");
    expect(bundle.outputs.size).toBe(0);
    expect(bundle.modules.size).toBe(1);
  });

  it("ignores an asset whose chunks match nothing", () => {
    const bundle = fromWebpackStats(
      {
        modules: [{ name: "a", size: 1, chunks: [0] }],
        assets: [{ name: "orphan.js", size: 5, chunks: [9] }],
      },
      "x",
    );
    expect(bundle.outputs.get("orphan.js")?.contributions.size).toBe(0);
  });

  it("does not mark an entry module as the entry point of a non-entry chunk", () => {
    const bundle = fromWebpackStats(
      {
        modules: [{ name: "a", size: 1, chunks: [0] }],
        chunks: [{ id: 0, entry: false }],
        assets: [{ name: "main.js", size: 1, chunks: [0] }],
      },
      "x",
    );
    expect(bundle.outputs.get("main.js")?.entryPoint).toBeUndefined();
  });
});

describe("rejecting malformed webpack stats", () => {
  it("names a module with neither name nor identifier", () => {
    expect(() => fromWebpackStats(fixtureJson("malformed", "webpack-nameless-module.json"), "x")).toThrow(
      'modules[0] must have a non-empty "name" or "identifier"',
    );
  });

  it("rejects an empty name that would collide with every other empty name", () => {
    expect(() => fromWebpackStats({ modules: [{ name: "", size: 1 }] }, "x")).toThrow(
      MetafileError,
    );
  });

  it("rejects modules that are not an array", () => {
    expect(() => fromWebpackStats({ modules: {} }, "x")).toThrow("modules must be an array");
  });

  it("names the module with a bad size", () => {
    expect(() => fromWebpackStats({ modules: [{ name: "a", size: "1" }] }, "x")).toThrow(
      "modules[0].size must be a non-negative number",
    );
  });

  it("indexes into the offending reason", () => {
    expect(() =>
      fromWebpackStats(
        { modules: [{ name: "a", size: 1, reasons: [{ moduleName: "b" }, 7] }] },
        "x",
      ),
    ).toThrow("modules[0].reasons[1] must be an object");
  });

  it("rejects a chunk id that is neither a number nor a string", () => {
    expect(() => fromWebpackStats({ modules: [{ name: "a", size: 1, chunks: [null] }] }, "x")).toThrow(
      "modules[0].chunks[0] must be a string",
    );
  });

  it("names the offending asset", () => {
    expect(() =>
      fromWebpackStats({ modules: [], assets: [{ name: "a.js" }] }, "x"),
    ).toThrow("assets[0].size must be a non-negative number");
  });

  it("rejects a top-level array", () => {
    expect(() => fromWebpackStats([], "x")).toThrow("stats must be an object");
  });

  it("keeps the fixture loading through the public entry point too", () => {
    expect(() => fromWebpackStats(stats(), "app-stats.json")).not.toThrow();
  });
});
