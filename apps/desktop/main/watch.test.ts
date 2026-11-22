// Real file-system events: generous timeouts so this stays reliable on CI runners.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigWatcher, watchedPaths } from "./watch";

let root: string, home: string, project: string;
let changes = 0;
let watcher: ConfigWatcher;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForChange(since: number, timeoutMs = 8000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (changes > since) return true;
    await sleep(50);
  }
  return false;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-watch-"));
  home = join(root, "home");
  project = join(root, "project");
  await mkdir(join(home, ".claude", "agents"), { recursive: true });
  await mkdir(join(home, ".claude", "projects"), { recursive: true });
  await mkdir(project, { recursive: true });
  watcher = new ConfigWatcher(() => changes++, 100);
  await watcher.watch(watchedPaths({ home, project, env: {} }));
});

after(async () => {
  await watcher.close();
  await rm(root, { recursive: true, force: true });
});

test("watches project paths only when a project is selected", () => {
  const withProject = watchedPaths({ home, project, env: {} });
  const globalOnly = watchedPaths({ home, project: "", env: {} });
  assert.ok(withProject.includes(join(project, "CLAUDE.md")));
  assert.ok(globalOnly.every((p) => p.startsWith(home)));
});

test("reports a new agent file", async () => {
  const since = changes;
  await writeFile(join(home, ".claude", "agents", "new.md"), "---\nname: new\n---\n");
  assert.ok(await waitForChange(since), "no change reported");
});

test("reports a config file created where none existed", async () => {
  const since = changes;
  await writeFile(join(project, "CLAUDE.md"), "# rules\n");
  assert.ok(await waitForChange(since), "no change reported");
});

test("ignores unrelated files next to config folders", async () => {
  await sleep(300); // let earlier events settle
  const since = changes;
  await writeFile(join(home, ".claude", "projects", "session.jsonl"), "{}\n");
  await writeFile(join(home, ".claude", "history.jsonl"), "{}\n");
  assert.equal(await waitForChange(since, 1500), false, "unrelated change reported");
});
