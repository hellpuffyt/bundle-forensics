/** Comparing two builds of the same app. */

import { describe, expect, it } from "vitest";

import { changes, diffBundles } from "../src/diff.js";
import type { Change } from "../src/diff.js";
import { afterBundle, beforeBundle, fixtureBundle } from "./helpers.js";

const before = beforeBundle();
const after = afterBundle();
const diff = diffBundles(before, after);

const row = (rows: readonly Change[], key: string): Change | undefined =>
  rows.find((r) => r.key === key);

describe("changes", () => {
  const a = new Map([["x", 10], ["y", 5], ["z", 7]]);
  const b = new Map([["x", 20], ["y", 5], ["w", 1]]);

  it("classifies growth", () => {
    expect(row(changes(a, b), "x")).toEqual({
      key: "x",
      before: 10,
      after: 20,
      delta: 10,
      status: "grew",
    });
  });

  it("classifies a shrink", () => {
    const shrunk = changes(new Map([["x", 10]]), new Map([["x", 4]]));
    expect(shrunk[0]?.status).toBe("shrank");
    expect(shrunk[0]?.delta).toBe(-6);
  });

  it("classifies an addition", () => {
    expect(row(changes(a, b), "w")?.status).toBe("added");
  });

  it("classifies a removal", () => {
    expect(row(changes(a, b), "z")?.status).toBe("removed");
  });

  it("drops unchanged rows by default", () => {
    expect(row(changes(a, b), "y")).toBeUndefined();
  });

  it("keeps unchanged rows on request", () => {
    expect(row(changes(a, b, { includeUnchanged: true }), "y")?.status).toBe("unchanged");
  });

  it("treats a zero-to-zero row as unchanged, not as an addition", () => {
    expect(changes(new Map([["x", 0]]), new Map([["x", 0]]))).toEqual([]);
  });

  it("sorts by magnitude, so a big removal outranks a small addition", () => {
    const rows = changes(new Map([["big", 100]]), new Map([["small", 1]]));
    expect(rows.map((r) => r.key)).toEqual(["big", "small"]);
  });

  it("breaks ties by key so output is stable", () => {
    const rows = changes(new Map(), new Map([["b", 5], ["a", 5]]));
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("handles two empty tables", () => {
    expect(changes(new Map(), new Map())).toEqual([]);
  });
});

describe("diffBundles totals", () => {
  it("labels both sides", () => {
    expect(diff.beforeLabel).toBe("app-before.json");
    expect(diff.afterLabel).toBe("app-after.json");
  });

  it("reports the totals and their delta", () => {
    expect(diff.totalBefore).toBe(69450);
    expect(diff.totalAfter).toBe(83490);
    expect(diff.totalDelta).toBe(14040);
  });

  it("keeps the delta consistent with the two totals", () => {
    expect(diff.totalAfter - diff.totalBefore).toBe(diff.totalDelta);
  });

  it("restricts to one output when asked", () => {
    const app = diffBundles(before, after, "dist/app.js");
    expect(app.totalBefore).toBe(67700);
    expect(app.totalAfter).toBe(74020);
    expect(app.totalDelta).toBe(6320);
  });
});

describe("diffBundles rows", () => {
  it("compares outputs", () => {
    expect(row(diff.outputs, "dist/worker.js")).toMatchObject({
      before: 1750,
      after: 9470,
      status: "grew",
    });
  });

  it("names the package that arrived", () => {
    expect(row(diff.packages, "date-fns")).toMatchObject({
      before: 0,
      after: 18000,
      status: "added",
    });
  });

  it("names the package that left", () => {
    expect(row(diff.packages, "left-pad")).toMatchObject({ after: 0, status: "removed" });
    expect(row(diff.packages, "tiny-date")?.status).toBe("removed");
  });

  it("shows a deduplicated package as a shrink, not a removal", () => {
    expect(row(diff.packages, "object-assign")).toMatchObject({
      before: 3700,
      after: 1800,
      status: "shrank",
    });
  });

  it("gives first-party source its own synthetic row", () => {
    expect(row(diff.packages, "(first-party)")).toMatchObject({
      before: 3150,
      after: 3290,
      status: "grew",
    });
  });

  it("omits the first-party row when there is no first-party code", () => {
    const empty = fixtureBundle("esbuild", "empty.json");
    expect(diffBundles(empty, empty).packages).toEqual([]);
  });

  it("orders package rows by magnitude", () => {
    expect(diff.packages.map((r) => r.key)).toEqual([
      "date-fns",
      "tiny-date",
      "object-assign",
      "react",
      "left-pad",
      "(first-party)",
    ]);
  });

  it("compares individual modules too", () => {
    expect(row(diff.modules, "node_modules/react/cjs/react.production.min.js")).toMatchObject({
      before: 58000,
      after: 59000,
      delta: 1000,
    });
  });

  it("omits modules whose contribution did not move", () => {
    expect(row(diff.modules, "src/components/Button.tsx")).toBeUndefined();
    expect(row(diff.modules, "node_modules/react/index.js")).toBeUndefined();
  });

  it("package deltas sum to the total delta", () => {
    const sum = diff.packages.reduce((total, r) => total + r.delta, 0);
    expect(sum).toBe(diff.totalDelta);
  });

  it("module deltas sum to the total delta", () => {
    const sum = diff.modules.reduce((total, r) => total + r.delta, 0);
    expect(sum).toBe(diff.totalDelta);
  });
});

describe("duplicate tracking across a diff", () => {
  it("notices a duplicate that was resolved", () => {
    expect(diff.duplicatesResolved).toEqual(["object-assign"]);
    expect(diff.duplicatesIntroduced).toEqual([]);
  });

  it("notices a duplicate that was introduced, by diffing the other way", () => {
    const reversed = diffBundles(after, before);
    expect(reversed.duplicatesIntroduced).toEqual(["object-assign"]);
    expect(reversed.duplicatesResolved).toEqual([]);
  });

  it("reports neither when a duplicate survives", () => {
    const same = diffBundles(before, before);
    expect(same.duplicatesResolved).toEqual([]);
    expect(same.duplicatesIntroduced).toEqual([]);
  });
});

describe("diffing a build against itself", () => {
  const same = diffBundles(before, before);

  it("reports a zero delta", () => {
    expect(same.totalDelta).toBe(0);
  });

  it("reports no rows at any level", () => {
    expect(same.outputs).toEqual([]);
    expect(same.packages).toEqual([]);
    expect(same.modules).toEqual([]);
  });
});

describe("diffing across bundler formats", () => {
  it("compares an esbuild build against a webpack one without complaint", () => {
    const mixed = diffBundles(before, fixtureBundle("webpack", "app-stats.json"));
    expect(mixed.totalDelta).toBe(147500 - 69450);
    expect(mixed.packages.some((r) => r.key === "lodash")).toBe(true);
  });
});
