/**
 * Rendering.
 *
 * These are golden-output tests on purpose. The renderers are the part
 * of the tool a human reads, so "it produced a string" is not an
 * assertion worth writing; the tests below pin alignment, sign, sorting
 * and the exact wording of the empty cases.
 */

import { describe, expect, it } from "vitest";

import { diffBundles } from "../src/diff.js";
import { whyIncluded } from "../src/graph.js";
import { contributionsByModule, totalBytes } from "../src/model.js";
import { findDuplicates, packageReport } from "../src/packages.js";
import {
  definitions,
  describeEntryPoints,
  formatBytes,
  formatDelta,
  formatShare,
  renderDiff,
  renderDuplicates,
  renderModules,
  renderPackages,
  renderSummary,
  renderWhy,
  table,
} from "../src/report.js";
import { afterBundle, beforeBundle, fixtureBundle } from "./helpers.js";

const bundle = beforeBundle();

describe("formatBytes", () => {
  it("prints small sizes exactly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("switches to kB at exactly 1000", () => {
    expect(formatBytes(1000)).toBe("1.0 kB");
    expect(formatBytes(67700)).toBe("67.7 kB");
  });

  it("switches to MB at exactly a million", () => {
    expect(formatBytes(1_000_000)).toBe("1.00 MB");
    expect(formatBytes(2_345_678)).toBe("2.35 MB");
  });

  it("keeps the sign of a negative size", () => {
    expect(formatBytes(-42)).toBe("-42 B");
    expect(formatBytes(-1500)).toBe("-1.5 kB");
  });
});

describe("formatDelta", () => {
  it("always shows a sign", () => {
    expect(formatDelta(1500)).toBe("+1.5 kB");
    expect(formatDelta(-1500)).toBe("-1.5 kB");
  });

  it("marks no change distinctly from a rounding-to-zero change", () => {
    expect(formatDelta(0)).toBe("±0 B");
    expect(formatDelta(1)).toBe("+1 B");
  });
});

describe("formatShare", () => {
  it("prints one decimal place", () => {
    expect(formatShare(1, 3)).toBe("33.3%");
    expect(formatShare(1, 1)).toBe("100.0%");
  });

  it("refuses to divide by zero", () => {
    expect(formatShare(5, 0)).toBe("—");
    expect(formatShare(0, -1)).toBe("—");
  });
});

describe("table", () => {
  it("pads columns to the widest cell", () => {
    expect(table(["a", "bb"], [["xxx", "y"]])).toBe("a    bb\n---  --\nxxx  y\n");
  });

  it("right-aligns the columns told to", () => {
    expect(table(["n"], [["1"], ["22"]], ["right"])).toBe(" n\n--\n 1\n22\n");
  });

  it("trims the trailing padding that would make diffs unreadable", () => {
    const rendered = table(["a", "b"], [["x", ""]]);
    expect(rendered.split("\n").every((line) => line === line.trimEnd())).toBe(true);
  });

  it("renders a header even with no rows", () => {
    expect(table(["only"], [])).toBe("only\n----\n");
  });

  it("tolerates a row shorter than the header", () => {
    expect(table(["a", "b"], [["x"]])).toBe("a  b\n-  -\nx\n");
  });
});

describe("definitions", () => {
  it("aligns labels left and values right with no header rule", () => {
    expect(definitions([["short", "1"], ["a longer label", "22"]])).toBe(
      "short            1\na longer label  22\n",
    );
  });

  it("handles a single row", () => {
    expect(definitions([["a", "b"]])).toBe("a  b\n");
  });
});

describe("renderSummary", () => {
  const rendered = renderSummary(bundle);

  it("leads with the label", () => {
    expect(rendered.startsWith("app-before.json\n\n")).toBe(true);
  });

  it("states the stats format", () => {
    expect(rendered).toContain("stats format                 esbuild");
  });

  it("splits first-party from dependency weight", () => {
    expect(rendered).toContain("first-party            3.1 kB (4.5%)");
    expect(rendered).toContain("dependencies         66.3 kB (95.5%)");
  });

  it("counts duplicated packages", () => {
    expect(rendered).toContain("duplicated packages                1");
  });

  it("lists outputs biggest first with their entry points", () => {
    const outputs = rendered.slice(rendered.indexOf("outputs\n\n"));
    expect(outputs).toContain("dist/app.js     67.7 kB       11  src/index.ts");
    expect(outputs.indexOf("dist/app.js")).toBeLessThan(outputs.indexOf("dist/worker.js"));
  });

  it("shows an em dash for a chunk with no entry point", () => {
    expect(renderSummary(fixtureBundle("esbuild", "cyclic.json"))).toContain(
      "dist/chunk-SHARED.js",
    );
    expect(renderSummary(fixtureBundle("esbuild", "cyclic.json"))).toMatch(/chunk-SHARED\.js.*—/);
  });

  it("narrows to one output, counting it as one", () => {
    const one = renderSummary(bundle, "dist/worker.js");
    expect(one).toMatch(/^outputs +1$/m);
    expect(one).not.toContain("dist/app.js");
  });

  it("survives an empty build without dividing by zero", () => {
    const empty = renderSummary(fixtureBundle("esbuild", "empty.json"));
    expect(empty).toMatch(/^total size +0 B$/m);
    expect(empty).toMatch(/^first-party +0 B \(—\)$/m);
  });
});

describe("renderPackages", () => {
  it("renders every package with its share", () => {
    const rendered = renderPackages(packageReport(bundle), totalBytes(bundle));
    expect(rendered).toContain("react          58.4 kB  84.1%        2");
  });

  it("flags a duplicated package in the note column", () => {
    const rendered = renderPackages(packageReport(bundle), totalBytes(bundle));
    expect(rendered).toMatch(/object-assign.*2 copies/);
  });

  it("leaves the note empty for a single-copy package", () => {
    const rendered = renderPackages(packageReport(bundle), totalBytes(bundle));
    expect(rendered).toMatch(/left-pad\s+600 B\s+0\.9%\s+1$/m);
  });

  it("says so when there is nothing to report", () => {
    expect(renderPackages([], 0)).toBe("no packages contribute to this build\n");
  });
});

describe("renderDuplicates", () => {
  const rendered = renderDuplicates(findDuplicates(bundle));

  it("heads each block with the package and the recoverable bytes", () => {
    expect(rendered.startsWith("object-assign  3.7 kB in 2 copies, 1.8 kB recoverable\n")).toBe(
      true,
    );
  });

  it("lists every install root, largest first", () => {
    expect(rendered).toContain("node_modules/classnames/node_modules/object-assign  1.9 kB");
    expect(rendered).toContain("node_modules/object-assign                          1.8 kB");
  });

  it("says so when there are none", () => {
    expect(renderDuplicates([])).toBe("no duplicated packages\n");
  });

  it("separates multiple duplicated packages with a blank line", () => {
    const two = renderDuplicates([
      ...findDuplicates(bundle),
      ...findDuplicates(fixtureBundle("esbuild", "cyclic.json")),
    ]);
    expect(two).toContain("\n\ntslib");
  });
});

describe("renderWhy", () => {
  it("heads with the module and its size", () => {
    const target = "node_modules/left-pad/index.js";
    const rendered = renderWhy(target, whyIncluded(bundle, target), 600);
    expect(rendered.startsWith(`${target}  (600 B in the bundle)\n`)).toBe(true);
  });

  it("indents each hop one step further", () => {
    const target = "node_modules/object-assign/index.js";
    const rendered = renderWhy(target, whyIncluded(bundle, target), 1800);
    expect(rendered).toContain("    -> src/app.tsx  [import-statement \"./app\"]");
    expect(rendered).toContain("      -> node_modules/react/index.js");
  });

  it("names the entry point each chain starts from", () => {
    const target = "node_modules/tiny-date/index.js";
    const rendered = renderWhy(target, whyIncluded(bundle, target), 2600);
    expect(rendered).toContain("  from src/index.ts");
    expect(rendered).toContain("  from src/worker.ts");
  });

  it("omits the specifier when the bundler did not record one", () => {
    const rendered = renderWhy(
      "b.js",
      [{ entry: "a.js", links: [{ from: "a.js", to: "b.js", kind: "require-call" }] }],
      10,
    );
    expect(rendered).toContain("-> b.js  [require-call]");
  });

  it("says when a module is itself the entry point", () => {
    const rendered = renderWhy("src/worker.ts", whyIncluded(bundle, "src/worker.ts"), 250);
    expect(rendered).toContain("(this module is the entry point)");
  });

  it("says when nothing reaches the module", () => {
    expect(renderWhy("x.js", [], 0)).toContain("no entry point reaches this module");
  });
});

describe("renderDiff", () => {
  const diff = diffBundles(bundle, afterBundle());

  it("heads with both labels and the totals", () => {
    const rendered = renderDiff(diff, 20, "packages");
    expect(rendered.startsWith("app-before.json -> app-after.json\n\n")).toBe(true);
    expect(rendered).toContain("delta   +14.0 kB");
  });

  it("shows package rows by default", () => {
    expect(renderDiff(diff, 20, "packages")).toContain("date-fns       added        0 B  18.0 kB");
  });

  it("switches to module rows on request", () => {
    const rendered = renderDiff(diff, 20, "modules");
    expect(rendered).toContain("node_modules/date-fns/index.js");
    expect(rendered).not.toContain("(first-party)");
  });

  it("switches to output rows on request", () => {
    const rendered = renderDiff(diff, 20, "outputs");
    expect(rendered).toContain("dist/worker.js");
    expect(rendered).toContain("dist/app.js");
  });

  it("truncates to the limit and says how many it hid", () => {
    const rendered = renderDiff(diff, 2, "packages");
    expect(rendered).toContain("... 4 more rows (use --top)");
    expect(rendered).not.toContain("left-pad");
  });

  it("does not mention truncation when nothing was hidden", () => {
    expect(renderDiff(diff, 20, "packages")).not.toContain("more rows");
  });

  it("calls out resolved duplicates", () => {
    expect(renderDiff(diff, 20, "packages")).toContain("duplicates resolved: object-assign");
  });

  it("calls out introduced duplicates", () => {
    const reversed = diffBundles(afterBundle(), bundle);
    expect(renderDiff(reversed, 20, "packages")).toContain(
      "duplicates introduced: object-assign",
    );
  });

  it("says so when a build did not change", () => {
    const same = renderDiff(diffBundles(bundle, bundle), 20, "packages");
    expect(same).toMatch(/^delta +±0 B$/m);
    expect(same).toContain("no changes");
  });
});

describe("renderModules", () => {
  const contributions = contributionsByModule(bundle);

  it("sorts by size, biggest first", () => {
    const rendered = renderModules(contributions, totalBytes(bundle), 3);
    const lines = rendered.trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[2]).toContain("react.production.min.js");
  });

  it("shows each module's share of the total", () => {
    expect(renderModules(contributions, totalBytes(bundle), 1)).toContain("83.5%");
  });

  it("says so when there is nothing to show", () => {
    expect(renderModules(new Map(), 0, 10)).toBe("no modules\n");
  });
});

describe("describeEntryPoints", () => {
  it("joins the entry points", () => {
    expect(describeEntryPoints(bundle)).toBe("src/index.ts, src/worker.ts");
  });

  it("says none when there are none", () => {
    expect(describeEntryPoints(fixtureBundle("esbuild", "empty.json"))).toBe("none");
  });
});
