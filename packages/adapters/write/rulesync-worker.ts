// Runs rulesync `generate` in its own process whose home directory is a staging
// folder, so rulesync can only ever write inside that folder. The parent compares
// the staged files with the real ones and applies them itself (with backups).
//
// Input:  KITROOM_JOB    JSON { stagingRoot, stagingHome, inputRoot, runs: [{ targets, features }], global, outputRoot }
//         Each run is one `generate` (features can need different targets).
// Output: KITROOM_RESULT path of a JSON file to write { outputs: string[] }
import { realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { generate } from "rulesync";

interface Job {
  stagingRoot: string;
  stagingHome: string;
  inputRoot: string;
  runs: { targets: string[]; features: string[] }[];
  /** false = project mode: generate into `outputRoot` (a staging project folder). */
  global?: boolean;
  outputRoot?: string;
}

function fail(message: string): never {
  console.error(`rulesync-worker: ${message}`);
  process.exit(2);
}

const job = JSON.parse(process.env.KITROOM_JOB ?? "null") as Job | null;
const resultPath = process.env.KITROOM_RESULT;
if (!job || !resultPath) fail("missing job");

// Refuse to run unless every home lookup and the cwd point into the staging area.
const real = (p: string | undefined) => (p ? realpathSync(p) : undefined);
const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const root = realpathSync(job.stagingRoot);
const home = realpathSync(job.stagingHome);
if (!inside(home, root)) fail("staging home is outside the staging root");
if (real(process.env.HOME_DIR) !== home) fail("HOME_DIR is not the staging home");
if (real(homedir()) !== home) fail("os.homedir() is not the staging home");
if (!inside(realpathSync(process.cwd()), root)) fail("cwd is outside the staging root");
const global = job.global !== false;
const outputRoot = global ? home : realpathSync(job.outputRoot ?? "");
if (!inside(outputRoot, root)) fail("output folder is outside the staging root");

// Paths are relative to the output root (the staging home or staging project).
const outputs = new Set<string>();
for (const run of job.runs) {
  const result = await generate({
    global,
    ...(global ? {} : { outputRoots: [outputRoot] }),
    inputRoots: [job.inputRoot],
    targets: run.targets as never,
    features: run.features as never,
    delete: false,
    silent: true,
  });
  if (result.sourceLoadFailed) fail(`could not read source: ${result.sourceLoadFailedFeatures.join(", ")}`);
  for (const p of [
    ...result.rulesPaths,
    ...result.mcpPaths,
    ...result.subagentsPaths,
    ...result.skillsPaths,
    ...result.commandsPaths,
    ...result.permissionsPaths,
  ]) {
    outputs.add(p);
  }
}
writeFileSync(resultPath, JSON.stringify({ outputs: [...outputs] }));
process.exit(0);
