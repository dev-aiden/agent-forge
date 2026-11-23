#!/usr/bin/env node
// Launches the app with --smoke-test and fails unless it exits 0 in time.
//
//   node scripts/smoke.mjs              # built output (out/) via the electron binary
//   node scripts/smoke.mjs --packaged   # unpacked app produced by electron-builder in release/
//   node scripts/smoke.mjs --packaged --arch x64   # macOS: the Intel build (runs under Rosetta)
//
// Extra arguments (e.g. --no-sandbox on Linux CI) are passed through to the app.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 120_000;

const args = process.argv.slice(2);
const packaged = args.includes("--packaged");
const archAt = args.indexOf("--arch");
const arch = archAt >= 0 ? args[archAt + 1] : undefined;
const passthrough = args.filter((a, i) => a !== "--packaged" && i !== archAt && i !== archAt + 1);

function packagedExecutable() {
  const release = join(appDir, "release");
  const candidates = {
    // electron-builder names the x64 folder plain "mac".
    darwin: (arch === "x64" ? ["mac"] : arch === "arm64" ? ["mac-arm64"] : ["mac-arm64", "mac", "mac-universal"]).map((d) => join(release, d, "Agent Forge.app", "Contents", "MacOS", "Agent Forge")),
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
// Never touch the real ~/.agent-forge: run the app against an empty temporary home.
const home = mkdtempSync(join(tmpdir(), "agent-forge-smoke-home-"));
const env = { ...process.env, HOME: home, USERPROFILE: home };
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
const child = spawn(cmd, cmdArgs, { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });

let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));

const timer = setTimeout(() => {
  console.error(`smoke: timed out after ${TIMEOUT_MS}ms`);
  process.stdout.write(output);
  child.kill();
  process.exit(1);
}, TIMEOUT_MS);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  process.stdout.write(output);
  if (code === 0) {
    // Windows GUI builds may not forward stdout; the exit code is the contract.
    if (!output.includes("SMOKE_OK")) console.warn("smoke: exit 0 but no SMOKE_OK line captured");
    else if (arch && !output.includes(`"arch":"${arch}"`)) {
      console.error(`smoke: expected arch ${arch}`);
      process.exit(1);
    }
    console.log("smoke: passed");
    process.exit(0);
  }
  console.error(`smoke: failed (code=${code} signal=${signal})`);
  process.exit(1);
});
