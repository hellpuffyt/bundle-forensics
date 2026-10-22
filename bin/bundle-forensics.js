#!/usr/bin/env node
// Thin launcher. The real CLI lives in src/cli.ts and is compiled to
// dist/cli.js; keeping the bin stub as committed JavaScript means the
// shebang and the executable bit never depend on compiler settings.
import { main } from "../dist/cli.js";

process.exitCode = await main(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
});
