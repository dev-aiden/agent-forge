// node-pty's macOS prebuilds ship `spawn-helper` without the execute bit when
// installed through npm, which makes every pty spawn fail with
// "posix_spawnp failed". Restore it after install. No-op elsewhere.
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "node_modules", "node-pty");
const candidates = [join(root, "build", "Release", "spawn-helper")];
const prebuilds = join(root, "prebuilds");
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) candidates.push(join(prebuilds, dir, "spawn-helper"));
}
for (const file of candidates) {
  if (existsSync(file)) {
    chmodSync(file, 0o755);
    console.log(`fix-node-pty: made executable ${file}`);
  }
}
