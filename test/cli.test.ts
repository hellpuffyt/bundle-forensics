/**
 * The command line, end to end.
 *
 * `main` is called exactly as `bin/bundle-forensics.js` calls it, on the
 * real fixture files, and both streams and the exit code are asserted.
 * Nothing is mocked, so a passing test here means the shipped binary
 * behaves this way.
 */

import { describe, expect, it } from "vitest";

import { main, parseCommandLine } from "../src/cli.js";
import { VERSION } from "../src/version.js";
import { capture, fixturePath } from "./helpers.js";

const BEFORE = fixturePath("esbuild", "app-before.json");
const AFTER = fixturePath("esbuild", "app-after.json");
const WEBPACK = fixturePath("webpack", "app-stats.json");

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const sink = capture();
  const code = await main(argv, sink.io);
  return { code, ...sink.read() };
}

describe("parseCommandLine", () => {
  it("defaults to help with no arguments", () => {
    expect(parseCommandLine([]).immediate).toContain("USAGE");
  });

  it("returns help for --help and -h", () => {
    expect(parseCommandLine(["--help"]).immediate).toContain("COMMANDS");
    expect(parseCommandLine(["-h"]).immediate).toContain("COMMANDS");
  });

  it("returns the version for --version and -v", () => {
    expect(parseCommandLine(["--version"]).immediate).toBe(`${VERSION}\n`);
    expect(parseCommandLine(["-v"]).immediate).toBe(`${VERSION}\n`);
  });

  it("lets --help win over a command", () => {
    expect(parseCommandLine(["summary", "x.json", "--help"]).immediate).toContain("USAGE");
  });

  it("splits the command from its operands", () => {
    const parsed = parseCommandLine(["why", "meta.json", "react"]);
    expect(parsed.command).toBe("why");
    expect(parsed.operands).toEqual(["meta.json", "react"]);
  });

  it("defaults --top to 20 and --detail to packages", () => {
    const parsed = parseCommandLine(["summary", "meta.json"]);
    expect(parsed.options.top).toBe(20);
    expect(parsed.options.detail).toBe("packages");
    expect(parsed.options.json).toBe(false);
    expect(parsed.options.output).toBeUndefined();
    expect(parsed.options.failOnGrowth).toBeUndefined();
  });

  it("reads every option", () => {
    const parsed = parseCommandLine([
      "diff", "a.json", "b.json",
      "--top", "5", "--detail", "modules", "--output", "dist/app.js",
      "--fail-on-growth", "1000", "--json",
    ]);
    expect(parsed.options).toEqual({
      top: 5,
      detail: "modules",
      output: "dist/app.js",
      failOnGrowth: 1000,
      json: true,
    });
  });

  it("accepts zero for --top and --fail-on-growth", () => {
    const parsed = parseCommandLine(["diff", "a", "b", "--top", "0", "--fail-on-growth", "0"]);
    expect(parsed.options.top).toBe(0);
    expect(parsed.options.failOnGrowth).toBe(0);
  });

  it("rejects an unknown command", () => {
    expect(() => parseCommandLine(["explode", "a.json"])).toThrow(/unknown command "explode"/);
  });

  it("rejects a non-integer --top", () => {
    expect(() => parseCommandLine(["summary", "a", "--top", "3.5"])).toThrow(/--top/);
    expect(() => parseCommandLine(["summary", "a", "--top", "many"])).toThrow(/--top/);
    expect(() => parseCommandLine(["summary", "a", "--top", "-1"])).toThrow(/--top/);
  });

  it("rejects an unknown --detail", () => {
    expect(() => parseCommandLine(["diff", "a", "b", "--detail", "chunks"])).toThrow(
      /--detail must be packages, modules or outputs/,
    );
  });

  it("rejects an unknown flag", () => {
    expect(() => parseCommandLine(["summary", "a", "--colour"])).toThrow(/--colour/);
  });
});

describe("help and version through main", () => {
  it("prints usage and succeeds with no arguments", async () => {
    const { code, out, err } = await run();
    expect(code).toBe(0);
    expect(out).toContain("bundle-forensics");
    expect(err).toBe("");
  });

  it("prints the version alone", async () => {
    expect((await run("--version")).out).toBe(`${VERSION}\n`);
  });

  it("documents every command it accepts", async () => {
    const { out } = await run("--help");
    for (const command of ["summary", "packages", "duplicates", "modules", "why", "diff"]) {
      expect(out).toContain(command);
    }
  });
});

describe("summary", () => {
  it("reports the fixture's totals", async () => {
    const { code, out } = await run("summary", BEFORE);
    expect(code).toBe(0);
    expect(out).toContain("total size                   69.5 kB");
    expect(out).toContain("duplicated packages                1");
  });

  it("emits machine-readable JSON with --json", async () => {
    const { out } = await run("summary", BEFORE, "--json");
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed["totalBytes"]).toBe(69450);
    expect(parsed["firstPartyBytes"]).toBe(3150);
    expect(parsed["dependencyBytes"]).toBe(66300);
    expect(parsed["duplicateCount"]).toBe(1);
    expect(parsed["entryPoints"]).toEqual(["src/index.ts", "src/worker.ts"]);
  });

  it("uses null, not undefined, for a chunk with no entry point", async () => {
    const { out } = await run("summary", fixturePath("esbuild", "cyclic.json"), "--json");
    const parsed = JSON.parse(out) as { outputs: { path: string; entryPoint: unknown }[] };
    const shared = parsed.outputs.find((o) => o.path === "dist/chunk-SHARED.js");
    expect(shared?.entryPoint).toBeNull();
  });

  it("narrows to one output", async () => {
    const { out } = await run("summary", BEFORE, "--output", "dist/worker.js", "--json");
    expect((JSON.parse(out) as { totalBytes: number }).totalBytes).toBe(1750);
  });

  it("reads webpack stats too", async () => {
    const { code, out } = await run("summary", WEBPACK);
    expect(code).toBe(0);
    expect(out).toMatch(/^stats format +webpack$/m);
  });
});

describe("packages", () => {
  it("lists packages biggest first", async () => {
    const { out } = await run("packages", BEFORE);
    expect(out.indexOf("react")).toBeLessThan(out.indexOf("left-pad"));
  });

  it("honours --top", async () => {
    const { out } = await run("packages", BEFORE, "--top", "2", "--json");
    const parsed = JSON.parse(out) as { name: string }[];
    expect(parsed.map((p) => p.name)).toEqual(["react", "object-assign"]);
  });

  it("treats --top 0 as no limit", async () => {
    const { out } = await run("packages", BEFORE, "--top", "0", "--json");
    expect((JSON.parse(out) as unknown[]).length).toBe(5);
  });

  it("exposes install roots in JSON", async () => {
    const { out } = await run("packages", BEFORE, "--json");
    const parsed = JSON.parse(out) as { name: string; copies: { root: string }[] }[];
    const oa = parsed.find((p) => p.name === "object-assign");
    expect(oa?.copies).toHaveLength(2);
  });
});

describe("duplicates", () => {
  it("finds the duplicated package", async () => {
    const { code, out } = await run("duplicates", BEFORE);
    expect(code).toBe(0);
    expect(out).toContain("object-assign  3.7 kB in 2 copies, 1.8 kB recoverable");
  });

  it("emits an exact JSON shape", async () => {
    const { out } = await run("duplicates", BEFORE, "--json");
    expect(JSON.parse(out)).toEqual([
      {
        name: "object-assign",
        bytes: 3700,
        moduleCount: 2,
        wastedBytes: 1800,
        copies: [
          {
            root: "node_modules/classnames/node_modules/object-assign",
            bytes: 1900,
            moduleCount: 1,
            modules: ["node_modules/classnames/node_modules/object-assign/index.js"],
          },
          {
            root: "node_modules/object-assign",
            bytes: 1800,
            moduleCount: 1,
            modules: ["node_modules/object-assign/index.js"],
          },
        ],
      },
    ]);
  });

  it("reports the clean build as clean", async () => {
    const { code, out } = await run("duplicates", AFTER);
    expect(code).toBe(0);
    expect(out).toBe("no duplicated packages\n");
  });
});

describe("modules", () => {
  it("lists modules biggest first", async () => {
    const { out } = await run("modules", BEFORE, "--top", "1");
    expect(out).toContain("react.production.min.js");
    expect(out).not.toContain("left-pad");
  });

  it("emits path and byte pairs in JSON", async () => {
    const { out } = await run("modules", BEFORE, "--top", "1", "--json");
    expect(JSON.parse(out)).toEqual([
      { path: "node_modules/react/cjs/react.production.min.js", bytes: 58000 },
    ]);
  });
});

describe("why", () => {
  it("explains a module by package name", async () => {
    const { code, out } = await run("why", BEFORE, "left-pad");
    expect(code).toBe(0);
    expect(out).toContain("from src/index.ts");
    expect(out).toContain("-> node_modules/left-pad/index.js  [import-statement \"left-pad\"]");
  });

  it("explains every module a package expands to", async () => {
    const { out } = await run("why", BEFORE, "object-assign");
    expect(out).toContain("node_modules/object-assign/index.js");
    expect(out).toContain("node_modules/classnames/node_modules/object-assign/index.js");
  });

  it("emits chains in JSON", async () => {
    const { out } = await run("why", BEFORE, "util/log.ts", "--json");
    const parsed = JSON.parse(out) as { module: string; bytes: number; chains: unknown[] }[];
    expect(parsed[0]?.module).toBe("src/util/log.ts");
    expect(parsed[0]?.bytes).toBe(400);
    expect(parsed[0]?.chains).toHaveLength(2);
  });

  it("honours --output when reporting the size", async () => {
    const { out } = await run("why", BEFORE, "util/log.ts", "--output", "dist/worker.js", "--json");
    expect((JSON.parse(out) as { bytes: number }[])[0]?.bytes).toBe(200);
  });

  it("fails with a suggestion when the module is unknown", async () => {
    const { code, err } = await run("why", BEFORE, "reakt");
    expect(code).toBe(1);
    expect(err).toContain('no module matching "reakt"');
  });

  it("prints suggestions when it has any", async () => {
    const { code, err } = await run("why", BEFORE, "somewhere/Button.tsx");
    expect(code).toBe(1);
    expect(err).toContain("did you mean: src/components/Button.tsx");
  });

  it("needs a module to explain", async () => {
    const { code, err } = await run("why", BEFORE);
    expect(code).toBe(2);
    expect(err).toContain("missing a module to explain");
  });
});

describe("diff", () => {
  it("reports the totals and the delta", async () => {
    const { code, out } = await run("diff", BEFORE, AFTER);
    expect(code).toBe(0);
    expect(out).toContain("delta   +14.0 kB");
  });

  it("emits the whole comparison in JSON", async () => {
    const { out } = await run("diff", BEFORE, AFTER, "--json");
    const parsed = JSON.parse(out) as { totalDelta: number; duplicatesResolved: string[] };
    expect(parsed.totalDelta).toBe(14040);
    expect(parsed.duplicatesResolved).toEqual(["object-assign"]);
  });

  it("succeeds when growth is within budget", async () => {
    const { code, err } = await run("diff", BEFORE, AFTER, "--fail-on-growth", "20000");
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("exits 3 when growth exceeds the budget", async () => {
    const { code, err } = await run("diff", BEFORE, AFTER, "--fail-on-growth", "1000");
    expect(code).toBe(3);
    expect(err).toBe("bundle grew by 14.0 kB, over the 1.0 kB budget\n");
  });

  it("does not trip the budget when the bundle shrank", async () => {
    const { code } = await run("diff", AFTER, BEFORE, "--fail-on-growth", "0");
    expect(code).toBe(0);
  });

  it("needs two stats files", async () => {
    expect((await run("diff", BEFORE)).code).toBe(2);
    expect((await run("diff")).err).toContain("missing a stats file for the older build");
  });
});

describe("failure modes", () => {
  it("exits 2 on an unknown command", async () => {
    const { code, err } = await run("explode", BEFORE);
    expect(code).toBe(2);
    expect(err).toContain('unknown command "explode"');
    expect(err).toContain("run 'bundle-forensics --help' for usage");
  });

  it("exits 2 on an unknown flag", async () => {
    expect((await run("summary", BEFORE, "--colour")).code).toBe(2);
  });

  it("exits 2 when a command has no operands", async () => {
    const { code, err } = await run("summary");
    expect(code).toBe(2);
    expect(err).toContain("missing a stats file");
  });

  it("exits 1 on a missing file, naming it", async () => {
    const { code, err } = await run("summary", "nope.json");
    expect(code).toBe(1);
    expect(err).toBe("bundle-forensics: no such file: nope.json\n");
  });

  it("exits 1 when the path is a directory, not a file", async () => {
    const { code, err } = await run("summary", fixturePath("esbuild"));
    expect(code).toBe(1);
    expect(err).toContain("cannot read");
  });

  it("exits 1 on invalid JSON", async () => {
    const { code, err } = await run("summary", fixturePath("malformed", "not-json.txt"));
    expect(code).toBe(1);
    expect(err).toContain("is not valid JSON");
  });

  it("exits 1 on an unrecognised stats shape", async () => {
    const { code, err } = await run("summary", fixturePath("malformed", "unknown-shape.json"));
    expect(code).toBe(1);
    expect(err).toContain("is not a recognised bundle stats file");
  });

  it("exits 1 on a structurally broken metafile, naming the key", async () => {
    const { code, err } = await run("summary", fixturePath("malformed", "bad-bytes.json"));
    expect(code).toBe(1);
    expect(err).toContain('inputs["src/index.ts"].bytes');
  });

  it("exits 1 for an output that does not exist, listing the real ones", async () => {
    const { code, err } = await run("summary", BEFORE, "--output", "dist/nope.js");
    expect(code).toBe(1);
    expect(err).toContain('no output named "dist/nope.js"');
    expect(err).toContain("did you mean: dist/app.js, dist/worker.js");
  });

  it("exits 70 with a stack when something unexpected happens", async () => {
    const sink = capture();
    const exploding = {
      stdout() {
        throw new TypeError("boom");
      },
      stderr: (text: string) => {
        sink.io.stderr(text);
      },
    };
    const code = await main(["summary", BEFORE], exploding);
    expect(code).toBe(70);
    expect(sink.read().err).toContain("internal error");
    expect(sink.read().err).toContain("boom");
  });
});
