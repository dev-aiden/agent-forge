// Runs the rulesync worker with plain Node (CLI scripts and tests).
// The desktop app uses Electron's utilityProcess instead (apps/desktop/main/forge.ts).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { WorkerRunner } from "./pipeline";

const WORKER = fileURLToPath(new URL("./rulesync-worker.ts", import.meta.url));

/** Runs the TypeScript worker through tsx. */
export const nodeWorkerRunner: WorkerRunner = ({ env, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), WORKER], {
      cwd,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`rulesync worker failed (exit ${code}): ${stderr.trim().slice(-500)}`)),
    );
  });
