/**
 * Package attribution and duplicate detection.
 *
 * `packageLocation` is the load-bearing function of the whole tool, so
 * it gets the pathological paths: nesting, scopes, Windows separators,
 * and the paths that only look like they name a package.
 */

import { describe, expect, it } from "vitest";

import {
  findDuplicates,
  firstPartyBytes,
  packageLocation,
  packageOf,
  packageReport,
} from "../src/packages.js";
import { fromEsbuildMetafile } from "../src/esbuild.js";
import { afterBundle, beforeBundle, fixtureBundle } from "./helpers.js";

describe("packageLocation", () => {
  it("names a plain dependency", () => {
    expect(packageLocation("node_modules/react/index.js")).toEqual({
      name: "react",
      root: "node_modules/react",
    });
  });

  it("keeps both segments of a scoped package", () => {
    expect(packageLocation("node_modules/@babel/runtime/helpers/esm/extends.js")).toEqual({
      name: "@babel/runtime",
      root: "node_modules/@babel/runtime",
    });
  });

  it("attributes a nested install to the inner package, not the outer one", () => {
    expect(packageLocation("node_modules/a/node_modules/b/index.js")).toEqual({
      name: "b",
      root: "node_modules/a/node_modules/b",
    });
  });

  it("distinguishes two install roots of the same package name", () => {
    const outer = packageLocation("node_modules/object-assign/index.js");
    const inner = packageLocation("node_modules/classnames/node_modules/object-assign/index.js");
    expect(outer?.name).toBe(inner?.name);
    expect(outer?.root).not.toBe(inner?.root);
  });

  it("handles a scoped package nested inside another package", () => {
    expect(packageLocation("node_modules/x/node_modules/@scope/y/a.js")?.name).toBe("@scope/y");
  });

  it("normalises Windows separators", () => {
    expect(packageLocation("node_modules\\react\\index.js")).toEqual({
      name: "react",
      root: "node_modules/react",
    });
  });

  it("works with an absolute path prefix", () => {
    expect(packageLocation("/repo/app/node_modules/react/index.js")?.root).toBe(
      "/repo/app/node_modules/react",
    );
  });

  it("works with webpack's leading ./", () => {
    expect(packageLocation("./node_modules/lodash/lodash.js")?.name).toBe("lodash");
  });

  it("returns undefined for first-party source", () => {
    expect(packageLocation("src/index.ts")).toBeUndefined();
    expect(packageLocation("")).toBeUndefined();
  });

  it("returns undefined when node_modules names no package", () => {
    expect(packageLocation("node_modules/")).toBeUndefined();
    expect(packageLocation("a/node_modules")).toBeUndefined();
  });

  it("returns undefined for a scope with no package after it", () => {
    expect(packageLocation("node_modules/@scope")).toBeUndefined();
    expect(packageLocation("node_modules/@scope/")).toBeUndefined();
  });

  it("is not fooled by a directory merely containing the words", () => {
    expect(packageLocation("src/my_node_modules_notes.ts")).toBeUndefined();
  });

  it("tolerates a doubled separator", () => {
    expect(packageLocation("node_modules//react/index.js")?.name).toBe("react");
  });
});

describe("packageOf", () => {
  it("returns just the name", () => {
    expect(packageOf("node_modules/left-pad/index.js")).toBe("left-pad");
  });

  it("returns undefined for first-party source", () => {
    expect(packageOf("src/app.tsx")).toBeUndefined();
  });
});

describe("packageReport", () => {
  const bundle = beforeBundle();
  const reports = packageReport(bundle);

  it("finds every package in the build", () => {
    expect(reports.map((r) => r.name)).toEqual([
      "react",
      "object-assign",
      "tiny-date",
      "classnames",
      "left-pad",
    ]);
  });

  it("sorts by contributed bytes, biggest first", () => {
    const sizes = reports.map((r) => r.bytes);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it("rolls a package's own modules together", () => {
    // react/index.js (400) plus the production build (58000).
    expect(reports.find((r) => r.name === "react")?.bytes).toBe(58400);
    expect(reports.find((r) => r.name === "react")?.moduleCount).toBe(2);
  });

  it("sums both copies of a duplicated package", () => {
    expect(reports.find((r) => r.name === "object-assign")?.bytes).toBe(3700);
  });

  it("splits a duplicated package into one entry per install root", () => {
    const copies = reports.find((r) => r.name === "object-assign")?.copies ?? [];
    expect(copies.map((c) => c.root)).toEqual([
      "node_modules/classnames/node_modules/object-assign",
      "node_modules/object-assign",
    ]);
    expect(copies.map((c) => c.bytes)).toEqual([1900, 1800]);
  });

  it("lists a copy's modules, sorted", () => {
    const copy = reports.find((r) => r.name === "react")?.copies[0];
    expect(copy?.modules).toEqual([
      "node_modules/react/cjs/react.production.min.js",
      "node_modules/react/index.js",
    ]);
  });

  it("counts a module that lands in two outputs once, at its combined size", () => {
    const tiny = reports.find((r) => r.name === "tiny-date");
    expect(tiny?.moduleCount).toBe(1);
    expect(tiny?.bytes).toBe(2600);
  });

  it("restricts to one output when asked", () => {
    const worker = packageReport(bundle, "dist/worker.js");
    expect(worker.map((r) => r.name)).toEqual(["tiny-date"]);
    expect(worker[0]?.bytes).toBe(1300);
  });

  it("is empty for a build with no dependencies", () => {
    expect(packageReport(fixtureBundle("esbuild", "empty.json"))).toEqual([]);
  });

  it("accounts for every byte, packages plus first-party", () => {
    const packaged = reports.reduce((sum, r) => sum + r.bytes, 0);
    expect(packaged + firstPartyBytes(bundle)).toBe(69450);
  });
});

describe("deterministic ordering of equal sizes", () => {
  const tied = fromEsbuildMetafile(
    {
      inputs: {},
      outputs: {
        "o.js": {
          bytes: 300,
          inputs: {
            "node_modules/zebra/i.js": { bytesInOutput: 100 },
            "node_modules/alpha/i.js": { bytesInOutput: 100 },
            "node_modules/x/node_modules/dup/i.js": { bytesInOutput: 50 },
            "node_modules/dup/i.js": { bytesInOutput: 50 },
          },
        },
      },
    },
    "tied.json",
  );

  it("breaks a three-way size tie between packages by name", () => {
    expect(packageReport(tied).map((r) => r.name)).toEqual(["alpha", "dup", "zebra"]);
  });

  it("breaks a size tie between install roots by root", () => {
    const dup = packageReport(tied).find((r) => r.name === "dup");
    expect(dup?.copies.map((c) => c.root)).toEqual([
      "node_modules/dup",
      "node_modules/x/node_modules/dup",
    ]);
  });

  it("still reports the tie as a duplicate worth half its bytes", () => {
    expect(findDuplicates(tied)[0]).toMatchObject({ name: "dup", bytes: 100, wastedBytes: 50 });
  });
});

describe("firstPartyBytes", () => {
  it("counts only modules outside node_modules", () => {
    expect(firstPartyBytes(beforeBundle())).toBe(3150);
  });

  it("respects an output filter", () => {
    expect(firstPartyBytes(beforeBundle(), "dist/worker.js")).toBe(450);
  });

  it("is zero when there is nothing to count", () => {
    expect(firstPartyBytes(fixtureBundle("esbuild", "empty.json"))).toBe(0);
  });
});

describe("findDuplicates", () => {
  it("finds the package installed twice", () => {
    const duplicates = findDuplicates(beforeBundle());
    expect(duplicates.map((d) => d.name)).toEqual(["object-assign"]);
  });

  it("reports recoverable bytes as everything but the largest copy", () => {
    const [duplicate] = findDuplicates(beforeBundle());
    expect(duplicate?.bytes).toBe(3700);
    expect(duplicate?.wastedBytes).toBe(1800);
  });

  it("ignores packages installed once, however many modules they have", () => {
    expect(findDuplicates(beforeBundle()).some((d) => d.name === "react")).toBe(false);
  });

  it("finds nothing once the duplicate is deduplicated", () => {
    expect(findDuplicates(afterBundle())).toEqual([]);
  });

  it("finds a duplicated scoped-package dependency", () => {
    const duplicates = findDuplicates(fixtureBundle("esbuild", "cyclic.json"));
    expect(duplicates.map((d) => d.name)).toEqual(["tslib"]);
    expect(duplicates[0]?.copies.map((c) => c.root)).toEqual([
      "node_modules/tslib",
      "node_modules/@scope/ui/node_modules/tslib",
    ]);
  });

  it("can be scoped to one output, which may hide a duplicate", () => {
    const bundle = fixtureBundle("esbuild", "cyclic.json");
    expect(findDuplicates(bundle, "dist/chunk-SHARED.js")).toEqual([]);
  });

  it("finds nothing in an empty build", () => {
    expect(findDuplicates(fixtureBundle("esbuild", "empty.json"))).toEqual([]);
  });

  it("also works on webpack stats", () => {
    const duplicates = findDuplicates(fixtureBundle("webpack", "app-stats.json"));
    expect(duplicates.map((d) => d.name)).toEqual(["tiny"]);
    expect(duplicates[0]?.wastedBytes).toBe(300);
  });
});
