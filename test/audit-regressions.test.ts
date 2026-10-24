/**
 * Regressions found during the production-readiness audit.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { main, sanitizeForTerminal } from "../src/cli.js";
import { capture, fixturePath } from "./helpers.js";

const BEFORE = fixturePath("esbuild", "app-before.json");
const AFTER = fixturePath("esbuild", "app-after.json");

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const sink = capture();
  const code = await main(argv, sink.io);
  return { code, ...sink.read() };
}

const scratch = mkdtempSync(join(tmpdir(), "bundle-forensics-audit-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("--output must name a real output", () => {
  it("diff refuses an output present in neither build instead of passing the budget", async () => {
    const result = await run("diff", BEFORE, AFTER, "--output", "dist/typo.js", "--fail-on-growth", "0");
    expect(result.code).toBe(1);
    expect(result.err).toContain('no output named "dist/typo.js"');
    expect(result.err).toContain("did you mean: dist/app.js");
  });

  it("diff still accepts an output that exists in only one of the builds", async () => {
    const result = await run("diff", BEFORE, AFTER, "--output", "dist/app.js");
    expect(result.code).toBe(0);
  });

  it("why refuses an unknown output", async () => {
    const result = await run("why", BEFORE, "left-pad", "--output", "dist/typo.js");
    expect(result.code).toBe(1);
    expect(result.err).toContain('no output named "dist/typo.js"');
  });
});

describe("terminal safety for untrusted stats files", () => {
  // A module path carrying an OSC 52 clipboard write and a cursor-up/erase sequence.
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const hostile = `src/${ESC}]52;c;ZWNobyBoaQ==${BEL}${ESC}[1A${ESC}[2Kevil.ts`;
  const meta = {
    inputs: { [hostile]: { bytes: 10, imports: [] } },
    outputs: { "dist/a.js": { bytes: 10, entryPoint: hostile, inputs: { [hostile]: { bytesInOutput: 10 } } } },
  };
  const file = join(scratch, "hostile.json");
  writeFileSync(file, JSON.stringify(meta));

  it.each([["modules"], ["summary"], ["packages"], ["duplicates"]])("%s never writes raw control characters", async (cmd) => {
    const result = await run(cmd, file);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain(ESC);
    expect(result.out).not.toContain(BEL);
  });

  it("escapes control characters visibly in text and keeps JSON valid", async () => {
    const text = await run("modules", file);
    expect(text.out).toContain("\\u001b]52;c;");
    const json = await run("modules", file, "--json");
    const rows = JSON.parse(json.out) as { path: string }[];
    expect(rows[0]?.path).toBe(hostile);
  });

  it("sanitizes error output too (suggestions come from the file)", async () => {
    const result = await run("why", file, "evil");
    expect(result.out + result.err).not.toContain(ESC);
  });

  it("keeps newlines and tabs, escapes CR, DEL and C1 controls", () => {
    expect(sanitizeForTerminal("a\tb\nc")).toBe("a\tb\nc");
    expect(sanitizeForTerminal("x\ry")).toBe("x\\u000dy");
    expect(sanitizeForTerminal("\u007f\u009b")).toBe("\\u007f\\u009b");
  });
});
