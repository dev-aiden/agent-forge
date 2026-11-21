#!/usr/bin/env node
// Launches the app with --smoke-test and fails unless it exits 0 in time.
//
//   node scripts/smoke.mjs              # built output (out/) via the electron binary
//   node scripts/smoke.mjs --packaged   # unpacked app produced by electron-builder in release/
//
// Extra arguments (e.g. --no-sandbox on Linux CI) are passed through to the app.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 120_000;

const args = process.argv.slice(2);
const packaged = args.includes("--packaged");
const passthrough = args.filter((a) => a !== "--packaged");

function packagedExecutable() {
  const release = join(appDir, "release");
  const candidates = {
    darwin: ["mac-arm64", "mac", "mac-universal"].map((d) => join(release, d, "Agent Forge.app", "Contents", "MacOS", "Agent Forge")),
    win32: [join(release, "win-unpacked", "Agent Forge.exe"), join(release, "win-arm64-unpacked", "Agent Forge.exe")],
    linux: [join(release, "linux-unpacked", "agent-forge"), join(release, "linux-arm64-unpacked", "agent-forge")],
  }[process.platform] ?? [];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`No packaged app found. Looked in:\n  ${candidates.join("\n  ")}`);
  return found;
}

const [cmd, cmdArgs] = packaged
  ? [packagedExecutable(), ["--smoke-test", ...passthrough]]
  : [createRequire(import.meta.url)("electron"), [appDir, "--smoke-test", ...passthrough]];

console.log(`smoke: ${cmd} ${cmdArgs.join(" ")}`);
const child = spawn(cmd, cmdArgs, { cwd: appDir, stdio: ["ignore", "pipe", "pipe"] });

let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));

const timer = setTimeout(() => {
  console.error(`smoke: timed out after ${TIMEOUT_MS}ms`);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  process.stdout.write(output);
  if (code === 0) {
    // Windows GUI builds may not forward stdout; the exit code is the contract.
    if (!output.includes("SMOKE_OK")) console.warn("smoke: exit 0 but no SMOKE_OK line captured");
    console.log("smoke: passed");
    process.exit(0);
  }
  console.error(`smoke: failed (code=${code} signal=${signal})`);
  process.exit(1);
});
