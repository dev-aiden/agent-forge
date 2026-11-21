#!/usr/bin/env tsx
// CLI for the read-only config scanner. See ../scan.ts for what it does and its safety guarantees.
//
//   npm run scan -- [--project <dir>] [--home <dir>] [--json] [--found]
import { homedir } from "node:os";
import { resolve } from "node:path";
import { formatText, scan } from "../scan";
import type { PathContext } from "../types";

function parseArgs(argv: string[]) {
  const opts = { project: process.cwd(), home: undefined as string | undefined, json: false, foundOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--found") opts.foundOnly = true;
    else if (a === "--project") opts.project = resolve(argv[++i] ?? ".");
    else if (a === "--home") opts.home = resolve(argv[++i] ?? ".");
    else if (a === "-h" || a === "--help") {
      console.log("Usage: npm run scan -- [--project <dir>] [--home <dir>] [--json] [--found]");
      process.exit(0);
    } else {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // With --home (used for testing against fixtures), ignore tool-specific env
  // overrides so the scan stays inside the given directory.
  const ctx: PathContext = opts.home
    ? { home: opts.home, project: opts.project, env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT } }
    : { home: homedir(), project: opts.project, env: process.env };

  const result = await scan(ctx);
  console.log(opts.json ? JSON.stringify(result, null, 2) : formatText(result, opts));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
