/**
 * Graph traversal.
 *
 * Two properties matter and both are tested against the cyclic fixture,
 * not just the tidy one: the walk terminates, and the chain it reports
 * is the shortest, not the first one a depth-first search stumbled into.
 */

import { describe, expect, it } from "vitest";

import { QueryError } from "../src/errors.js";
import {
  importedBy,
  imports,
  orphanModules,
  reachableFrom,
  resolveModules,
  resolveOneModule,
  shortestChain,
  whyIncluded,
} from "../src/graph.js";
import { fromEsbuildMetafile } from "../src/esbuild.js";
import { beforeBundle, fixtureBundle } from "./helpers.js";

const bundle = beforeBundle();
const cyclic = fixtureBundle("esbuild", "cyclic.json");

describe("imports", () => {
  it("lists what a module imports, sorted by target", () => {
    expect(imports(bundle, "src/app.tsx").map((l) => l.to)).toEqual([
      "node_modules/left-pad/index.js",
      "node_modules/react/index.js",
      "src/components/Button.tsx",
      "src/util/log.ts",
    ]);
  });

  it("carries the kind and the written specifier", () => {
    const [first] = imports(bundle, "src/util/log.ts");
    expect(first?.kind).toBe("import-statement");
    expect(first?.original).toBe("tiny-date");
  });

  it("includes external edges", () => {
    expect(imports(bundle, "src/index.ts").map((l) => l.to)).toContain("node:fs");
  });

  it("returns nothing for a module that is not in the graph", () => {
    expect(imports(bundle, "node:fs")).toEqual([]);
    expect(imports(bundle, "nope.js")).toEqual([]);
  });

  it("returns nothing for a leaf", () => {
    expect(imports(bundle, "node_modules/left-pad/index.js")).toEqual([]);
  });

  it("omits the specifier when the bundler recorded none", () => {
    const bare = fromEsbuildMetafile(
      { inputs: { "a.js": { bytes: 1, imports: [{ path: "b.js" }] } }, outputs: {} },
      "x",
    );
    expect(imports(bare, "a.js")).toEqual([
      { from: "a.js", to: "b.js", kind: "unknown" },
    ]);
    expect(importedBy(bare, "b.js")).toEqual([
      { from: "a.js", to: "b.js", kind: "unknown" },
    ]);
  });

  it("sorts two edges to the same target by kind", () => {
    const twice = fromEsbuildMetafile(
      {
        inputs: {
          "a.js": {
            bytes: 1,
            imports: [
              { path: "b.js", kind: "require-call" },
              { path: "b.js", kind: "dynamic-import" },
            ],
          },
        },
        outputs: {},
      },
      "x",
    );
    expect(imports(twice, "a.js").map((l) => l.kind)).toEqual([
      "dynamic-import",
      "require-call",
    ]);
  });
});

describe("importedBy", () => {
  it("finds every direct importer", () => {
    expect(importedBy(bundle, "node_modules/react/index.js").map((l) => l.from)).toEqual([
      "src/app.tsx",
      "src/components/Button.tsx",
    ]);
  });

  it("finds importers of a module that is not itself an input", () => {
    expect(importedBy(bundle, "node:fs").map((l) => l.from)).toEqual(["src/index.ts"]);
  });

  it("returns nothing for an entry point nobody imports", () => {
    expect(importedBy(bundle, "src/index.ts")).toEqual([]);
  });

  it("reports both sides of a cycle", () => {
    expect(importedBy(cyclic, "src/a.ts").map((l) => l.from)).toEqual([
      "src/b.ts",
      "src/main.ts",
    ]);
  });
});

describe("shortestChain", () => {
  it("returns an empty chain when the target is the entry itself", () => {
    expect(shortestChain(bundle, "src/index.ts", "src/index.ts")).toEqual({
      entry: "src/index.ts",
      links: [],
    });
  });

  it("finds a one-hop chain", () => {
    const chain = shortestChain(bundle, "src/index.ts", "src/app.tsx");
    expect(chain?.links.map((l) => l.to)).toEqual(["src/app.tsx"]);
  });

  it("finds the deep chain to a nested dependency", () => {
    const chain = shortestChain(
      bundle,
      "src/index.ts",
      "node_modules/object-assign/index.js",
    );
    expect(chain?.links.map((l) => l.to)).toEqual([
      "src/app.tsx",
      "node_modules/react/index.js",
      "node_modules/react/cjs/react.production.min.js",
      "node_modules/object-assign/index.js",
    ]);
  });

  it("prefers the shortest route when two exist", () => {
    // log.ts is reachable directly from the entry and also via app.tsx.
    const chain = shortestChain(bundle, "src/index.ts", "src/util/log.ts");
    expect(chain?.links).toHaveLength(1);
    expect(chain?.links[0]?.from).toBe("src/index.ts");
  });

  it("records the kind of each hop", () => {
    const chain = shortestChain(bundle, "src/index.ts", "node_modules/object-assign/index.js");
    expect(chain?.links.map((l) => l.kind)).toEqual([
      "import-statement",
      "import-statement",
      "require-call",
      "require-call",
    ]);
  });

  it("terminates on a cyclic graph", () => {
    const chain = shortestChain(cyclic, "src/main.ts", "src/b.ts");
    expect(chain?.links.map((l) => l.to)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns undefined when nothing connects the two", () => {
    expect(shortestChain(bundle, "src/worker.ts", "node_modules/react/index.js")).toBeUndefined();
  });

  it("returns undefined when the entry is not in the graph", () => {
    expect(shortestChain(bundle, "nope.js", "src/app.tsx")).toBeUndefined();
  });

  it("does not walk through a module absent from inputs", () => {
    const partial = fromEsbuildMetafile(
      {
        inputs: { "a.js": { bytes: 1, imports: [{ path: "missing.js" }] } },
        outputs: {},
      },
      "x",
    );
    expect(shortestChain(partial, "a.js", "missing.js")?.links).toHaveLength(1);
    expect(shortestChain(partial, "a.js", "z.js")).toBeUndefined();
  });
});

describe("whyIncluded", () => {
  it("reports one chain per entry point that reaches the module", () => {
    const chains = whyIncluded(bundle, "node_modules/tiny-date/index.js");
    expect(chains.map((c) => c.entry)).toEqual(["src/index.ts", "src/worker.ts"]);
  });

  it("reports only the entry points that actually reach it", () => {
    const chains = whyIncluded(bundle, "node_modules/left-pad/index.js");
    expect(chains.map((c) => c.entry)).toEqual(["src/index.ts"]);
  });

  it("reports an empty chain for a module that is an entry point", () => {
    const chains = whyIncluded(bundle, "src/worker.ts");
    expect(chains).toEqual([{ entry: "src/worker.ts", links: [] }]);
  });

  it("reports nothing for a module no entry point reaches", () => {
    expect(whyIncluded(cyclic, "src/unused.ts")).toEqual([]);
  });

  it("explains a dynamic import as such", () => {
    const chains = whyIncluded(cyclic, "node_modules/@scope/ui/dist/index.js");
    expect(chains[0]?.links[0]?.kind).toBe("dynamic-import");
  });
});

describe("reachableFrom", () => {
  it("includes the entry itself", () => {
    expect(reachableFrom(bundle, "src/worker.ts").has("src/worker.ts")).toBe(true);
  });

  it("includes externals, which are edges even though they are not inputs", () => {
    expect(reachableFrom(bundle, "src/index.ts").has("node:fs")).toBe(true);
  });

  it("stops at a disconnected component", () => {
    expect(reachableFrom(bundle, "src/worker.ts").has("node_modules/react/index.js")).toBe(false);
  });

  it("terminates on a cycle and collects both members", () => {
    const reached = reachableFrom(cyclic, "src/a.ts");
    expect([...reached].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("orphanModules", () => {
  it("finds nothing in a well-formed build", () => {
    expect(orphanModules(bundle)).toEqual([]);
  });

  it("finds modules no entry point reaches", () => {
    expect(orphanModules(cyclic)).toEqual(["node_modules/tslib/tslib.js", "src/unused.ts"]);
  });

  it("treats every module as an orphan when there are no entry points", () => {
    const noEntries = fromEsbuildMetafile(
      { inputs: { "a.js": { bytes: 1 } }, outputs: { "o.js": { bytes: 0 } } },
      "x",
    );
    expect(orphanModules(noEntries)).toEqual(["a.js"]);
  });
});

describe("resolveModules", () => {
  it("prefers an exact path", () => {
    expect(resolveModules(bundle, "src/app.tsx")).toEqual(["src/app.tsx"]);
  });

  it("expands a package name to all of its modules", () => {
    expect(resolveModules(bundle, "react")).toEqual([
      "node_modules/react/cjs/react.production.min.js",
      "node_modules/react/index.js",
    ]);
  });

  it("does not let a package name leak into substring matches", () => {
    // "react" must not also pull in react-adjacent paths via substring.
    expect(resolveModules(bundle, "react").every((p) => p.startsWith("node_modules/react/"))).toBe(
      true,
    );
  });

  it("matches a path suffix", () => {
    expect(resolveModules(bundle, "util/log.ts")).toEqual(["src/util/log.ts"]);
  });

  it("accepts a suffix written with backslashes", () => {
    expect(resolveModules(bundle, "util\\log.ts")).toEqual(["src/util/log.ts"]);
  });

  it("falls back to a substring match", () => {
    expect(resolveModules(bundle, "components")).toEqual(["src/components/Button.tsx"]);
  });

  it("returns every match of an ambiguous substring, sorted", () => {
    expect(resolveModules(bundle, "object-assign")).toEqual([
      "node_modules/classnames/node_modules/object-assign/index.js",
      "node_modules/object-assign/index.js",
    ]);
  });

  it("rejects the empty query", () => {
    expect(() => resolveModules(bundle, "")).toThrow("module query must not be empty");
  });

  it("reports a miss with the bundle label", () => {
    expect(() => resolveModules(bundle, "nonexistent")).toThrow(
      'no module matching "nonexistent" in app-before.json',
    );
  });

  it("suggests near misses by file name", () => {
    try {
      resolveModules(bundle, "src/deep/Button.jsx");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryError);
      expect((error as QueryError).suggestions).toEqual([]);
    }
  });

  it("suggests matches when the file name alone hits something", () => {
    try {
      resolveModules(bundle, "elsewhere/BUTTON.tsx");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as QueryError).suggestions).toEqual(["src/components/Button.tsx"]);
    }
  });
});

describe("resolveOneModule", () => {
  it("returns the single match", () => {
    expect(resolveOneModule(bundle, "util/log.ts")).toBe("src/util/log.ts");
  });

  it("refuses an ambiguous query and shows the candidates", () => {
    try {
      resolveOneModule(bundle, "object-assign");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as QueryError).message).toContain("matches 2 modules");
      expect((error as QueryError).suggestions).toHaveLength(2);
    }
  });

  it("propagates a miss", () => {
    expect(() => resolveOneModule(bundle, "nonexistent")).toThrow(QueryError);
  });
});
