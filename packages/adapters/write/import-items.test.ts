// Importing existing agents and skills: nothing the tools already have should
// change on the first apply after import.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PathContext } from "../types";
import { importAgents, importSkills } from "./import";
import { nodeWorkerRunner } from "./node-runner";
import { preview, type PipelineRunners } from "./pipeline";
import { listAgents, listSkills, saveAgent, saveSkill } from "./store";

let root: string, home: string, ctx: PathContext;
const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: null };

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kitroom-import-"));
  home = join(root, "home");
  ctx = { home, project: "", env: { KITROOM_HOME: join(root, "forge") } };
});

afterEach(() => rm(root, { recursive: true, force: true }));

const changed = async () => (await preview(ctx, runners)).changes.filter((c) => c.action !== "unchanged");

test("imports agents with tool-specific fields and applying changes nothing", async () => {
  await put(
    join(home, ".claude/agents/reviewer.md"),
    "---\nname: reviewer\ndescription: Reviews code\nmodel: sonnet\ntools: Read, Grep\ncolor: blue\npermissionMode: plan\n---\nYou review code.\n",
  );
  await put(
    join(home, ".codex/agents/reviewer.toml"),
    'name = "reviewer"\ndescription = "Reviews code"\nmodel = "gpt-5"\nsandbox_mode = "read-only"\ndeveloper_instructions = "You review code."\n',
  );
  await put(join(home, ".codex/agents/planner.toml"), 'name = "planner"\ndescription = "Plans"\ndeveloper_instructions = "Plan."\n');
  await put(join(home, ".claude/agents/bad name.md"), "---\nname: bad name\ndescription: x\n---\nx\n");
  await put(join(home, ".claude/agents/nodesc.md"), "---\nname: nodesc\n---\nx\n");

  const r = await importAgents(ctx);
  assert.deepEqual(r.added, ["planner", "reviewer"]);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.skipped, [
    { name: "bad name", reason: "invalid-name" },
    { name: "nodesc", reason: "no-description" },
  ]);
  const reviewer = (await listAgents(ctx)).find((a) => a.name === "reviewer")!;
  assert.deepEqual(reviewer.targets, ["claude", "codex"]);
  assert.deepEqual(reviewer.claudeExtra, { color: "blue", permissionMode: "plan" });
  assert.deepEqual(reviewer.codexExtra, { model: "gpt-5", sandbox_mode: "read-only" });

  const diff = await changed();
  assert.deepEqual(
    diff.map((c) => `${c.action} ${c.path.slice(home.length)}`),
    [],
    diff.map((c) => `--- ${c.path}\n${c.before}\n+++\n${c.after}`).join("\n"),
  );
});

test("editing an imported agent keeps its extras; a second import adds nothing", async () => {
  await put(join(home, ".claude/agents/reviewer.md"), "---\nname: reviewer\ndescription: Reviews code\ncolor: blue\n---\nYou review code.\n");
  await importAgents(ctx);
  const [a] = await listAgents(ctx);
  // The renderer never sends extras back.
  await saveAgent(ctx, { ...a!, claudeExtra: undefined, body: "You review code carefully.\n" }, "reviewer");
  const [b] = await listAgents(ctx);
  assert.deepEqual(b!.claudeExtra, { color: "blue" });
  assert.deepEqual(await importAgents(ctx), { added: [], conflicts: [], skipped: [] });
  const out = await changed();
  assert.equal(out.length, 1);
  assert.match(out[0]!.after!, /color: blue/);
});

test("reports agents whose Claude and Codex versions differ", async () => {
  await put(join(home, ".claude/agents/x.md"), "---\nname: x\ndescription: d\n---\nClaude text\n");
  await put(join(home, ".codex/agents/x.toml"), 'name = "x"\ndescription = "d"\ndeveloper_instructions = "Codex text"\n');
  const r = await importAgents(ctx);
  assert.deepEqual(r.conflicts, ["x"]);
  assert.equal((await listAgents(ctx))[0]!.body.trim(), "Claude text");
});

test("imports skills with bundled files and applying changes nothing", async () => {
  await put(
    join(home, ".claude/skills/deploy/SKILL.md"),
    "---\nname: deploy\ndescription: Deploys the app\nallowed-tools: Bash\nlicense: MIT\n---\nRun scripts/deploy.sh\n",
  );
  await put(join(home, ".claude/skills/deploy/scripts/deploy.sh"), "#!/bin/sh\necho deploy\n");
  await put(join(home, ".agents/skills/fmt/SKILL.md"), "---\nname: fmt\ndescription: Formats code\n---\nFormat it.\n");
  await put(join(home, ".claude/skills/synced/abc/SKILL.md"), "---\nname: web\ndescription: Synced\n---\nx\n");
  await put(join(home, ".codex/skills/old/SKILL.md"), "---\nname: old\ndescription: Old\n---\nx\n");
  await put(join(home, ".agents/skills/ui/SKILL.md"), "---\nname: ui\ndescription: Has UI file\n---\nx\n");
  await put(join(home, ".agents/skills/ui/agents/openai.yaml"), "interface:\n  display_name: UI\n");

  const r = await importSkills(ctx);
  assert.deepEqual(r.added, ["deploy", "fmt"]);
  assert.deepEqual(r.skipped, [
    { name: "old", reason: "legacy-location" },
    { name: "ui", reason: "codex-ui-file" },
  ]);
  const deploy = (await listSkills(ctx)).find((s) => s.name === "deploy")!;
  assert.deepEqual(deploy.files, ["scripts/deploy.sh"]);

  const diff = await changed();
  assert.deepEqual(
    diff.map((c) => `${c.action} ${c.path.slice(home.length)}`),
    [],
    diff.map((c) => `--- ${c.path}\n${c.before}\n+++\n${c.after}`).join("\n"),
  );
});

test("renaming an imported skill keeps its files and extras", async () => {
  await put(join(home, ".claude/skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Deploys\nallowed-tools: Bash\n---\nGo.\n");
  await put(join(home, ".claude/skills/deploy/scripts/deploy.sh"), "echo\n");
  await importSkills(ctx);
  const [s] = await listSkills(ctx);
  const saved = await saveSkill(ctx, { ...s!, name: "ship", extra: undefined }, "deploy");
  assert.deepEqual(saved.files, ["scripts/deploy.sh"]);
  const [t] = await listSkills(ctx);
  assert.equal(t!.name, "ship");
  assert.deepEqual(t!.extra, { claudecode: { "allowed-tools": "Bash" } });
  const out = await changed();
  const shipped = out.find((c) => c.path.replaceAll("\\", "/").endsWith("ship/scripts/deploy.sh"));
  assert.equal(shipped?.after, "echo\n");
  assert.match(await readFile(join(home, ".claude/skills/deploy/SKILL.md"), "utf8"), /deploy/);
});

test("skips skills with binary files instead of corrupting them", async () => {
  await put(join(home, ".claude/skills/logo/SKILL.md"), "---\nname: logo\ndescription: Logo\n---\nx\n");
  await mkdir(join(home, ".claude/skills/logo/assets"), { recursive: true });
  await writeFile(join(home, ".claude/skills/logo/assets/logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  const r = await importSkills(ctx);
  assert.deepEqual(r, { added: [], conflicts: [], skipped: [{ name: "logo", reason: "binary-file" }] });
});

test("sameMarkdown ignores key order and quoting only", async () => {
  const { sameMarkdown } = await import("./pipeline");
  assert.ok(sameMarkdown("---\na: 1\nb: 'x, y'\n---\nBody\n", "---\nb: x, y\na: 1\n---\nBody"));
  assert.ok(!sameMarkdown("---\na: 1\n---\nBody\n", "---\na: 2\n---\nBody\n"));
  assert.ok(!sameMarkdown("---\na: 1\n---\nBody\n", "---\na: 1\n---\nOther\n"));
  assert.ok(!sameMarkdown("# no frontmatter\n", "# no frontmatter\n\n"));
});

test("keeps an explicitly empty tools list and YAML block styles stay unchanged", async () => {
  await put(
    join(home, ".claude/agents/fw.md"),
    "---\nname: fw\ndescription: >\n  Firmware expert for a\n  long description\nmodel: inherit\ntools: []\n---\n\n# Firmware\n",
  );
  await importAgents(ctx);
  assert.deepEqual((await listAgents(ctx))[0]!.claudeExtra, { tools: [] });
  assert.deepEqual(await changed(), []);
});

test("skips items that would be duplicated or lose fields", async () => {
  await put(join(home, ".claude/agents/short.md"), "---\nname: long-name\ndescription: d\n---\nx\n");
  await put(join(home, ".claude/skills/tagged/SKILL.md"), "---\nname: tagged\ndescription: d\nversion: 2\n---\nx\n");
  await put(join(home, ".agents/skills/lic/SKILL.md"), "---\nname: lic\ndescription: d\nlicense: MIT\n---\nx\n");
  await put(join(home, ".claude/skills/dir/SKILL.md"), "---\nname: other\ndescription: d\n---\nx\n");
  assert.deepEqual((await importAgents(ctx)).skipped, [{ name: "long-name", reason: "file-name-differs" }]);
  assert.deepEqual((await importSkills(ctx)).skipped, [
    { name: "lic", reason: "unsupported-fields" },
    { name: "other", reason: "file-name-differs" },
    { name: "tagged", reason: "unsupported-fields" },
  ]);
});

test("migrateLegacyHome moves ~/.agent-forge to ~/.kitroom once", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { migrateLegacyHome } = await import("./store");
  const home = await mkdtemp(join(tmpdir(), "kitroom-migrate-"));
  const ctx = { home, project: "", env: {} };
  assert.equal(await migrateLegacyHome(ctx), false); // nothing to move
  await mkdir(join(home, ".agent-forge", "backups", "x"), { recursive: true });
  await writeFile(join(home, ".agent-forge", "settings.json"), "{}");
  assert.equal(await migrateLegacyHome(ctx), true);
  assert.equal(await readFile(join(home, ".kitroom", "settings.json"), "utf8"), "{}");
  assert.ok((await stat(join(home, ".kitroom", "backups", "x"))).isDirectory());
  await assert.rejects(stat(join(home, ".agent-forge")));
  // Never overwrite an existing ~/.kitroom.
  await mkdir(join(home, ".agent-forge"));
  assert.equal(await migrateLegacyHome(ctx), false);
  assert.equal(await migrateLegacyHome({ ...ctx, env: { KITROOM_HOME: join(home, "custom") } }), false);
});
