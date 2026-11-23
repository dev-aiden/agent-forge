// End-to-end preview → apply → undo against a fake home, with the real rulesync worker.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ManagedAgent } from "@kitroom/model";
import type { PathContext } from "../types";
import { nodeWorkerRunner } from "./node-runner";
import type { PipelineRunners } from "./pipeline";

const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: null };
import { apply, assertWritable, ConflictError, history, preview, undo } from "./pipeline";
import { deleteAgent, deleteSkill, listAgents, listSkills, saveAgent, saveSkill } from "./store";

let root: string;
let ctx: PathContext;
let claudeAgents: string, codexAgents: string;

const reviewer: ManagedAgent = {
  name: "forge-reviewer",
  description: "Reviews diffs",
  body: "Review carefully.",
  model: "sonnet",
  tools: ["Read", "Grep"],
  targets: ["claude", "codex"],
};

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function snapshot(dir: string, acc = new Map<string, string>()) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await snapshot(p, acc);
    else acc.set(p, createHash("sha256").update(await readFile(p)).digest("hex") + ":" + (await stat(p)).mtimeMs);
  }
  return acc;
}

const exists = async (p: string) => (await stat(p).catch(() => null)) !== null;
const toolHome = () => join(root, "home");

before(async () => {
  root = await mkdtemp(join(tmpdir(), "kitroom-pipeline-"));
});
after(() => rm(root, { recursive: true, force: true }));

beforeEach(async () => {
  await rm(toolHome(), { recursive: true, force: true });
  ctx = { home: toolHome(), project: "", env: {} };
  claudeAgents = join(toolHome(), ".claude", "agents");
  codexAgents = join(toolHome(), ".codex", "agents");
  // The user's own config, which must survive everything.
  await put(join(claudeAgents, "mine.md"), "---\nname: mine\n---\nMine.\n");
  await put(join(toolHome(), ".codex", "auth.json"), '{"OPENAI_API_KEY":"x"}');
  await put(join(toolHome(), ".claude.json"), '{"oauthAccount":{}}');
});

test("store round-trips an agent and rejects unsafe names", async () => {
  await saveAgent(ctx, reviewer);
  assert.deepEqual(await listAgents(ctx), [{ ...reviewer, body: "Review carefully.\n" }]);
  await assert.rejects(saveAgent(ctx, { ...reviewer, name: "../evil" }), /Name must/);
  await assert.rejects(saveAgent(ctx, { ...reviewer, name: "x", targets: [] }), /at least one tool/);
});

test("preview writes nothing to the tool config", async () => {
  await saveAgent(ctx, reviewer);
  const before = await snapshot(join(toolHome(), ".claude"));
  const beforeCodex = await snapshot(join(toolHome(), ".codex"));
  const set = await preview(ctx, runners);
  assert.deepEqual(
    set.changes.map((c) => [c.path, c.action]),
    [
      [join(claudeAgents, "forge-reviewer.md"), "create"],
      [join(codexAgents, "forge-reviewer.toml"), "create"],
    ],
  );
  assert.match(set.changes[0].after!, /model: sonnet/);
  assert.match(set.changes[1].after!, /developer_instructions/);
  assert.deepEqual(await snapshot(join(toolHome(), ".claude")), before);
  assert.deepEqual(await snapshot(join(toolHome(), ".codex")), beforeCodex);
});

test("apply writes files, backs up, and undo restores", async () => {
  await saveAgent(ctx, reviewer);
  const applied = await apply(ctx, await preview(ctx, runners), runners);
  assert.equal(applied.entries.length, 2);
  assert.ok(await exists(join(claudeAgents, "forge-reviewer.md")));
  assert.ok(await exists(join(codexAgents, "forge-reviewer.toml")));

  // Nothing left to do.
  const again = await preview(ctx, runners);
  assert.ok(again.changes.every((c) => c.action === "unchanged"));

  // Edit → modify; undo restores the first version.
  const v1 = await readFile(join(claudeAgents, "forge-reviewer.md"), "utf8");
  await saveAgent(ctx, { ...reviewer, description: "Reviews diffs v2" }, reviewer.name);
  const edit = await preview(ctx, runners);
  assert.deepEqual(edit.changes.map((c) => c.action), ["modify", "modify"]);
  assert.ok(edit.changes.every((c) => !c.unmanagedOverwrite));
  const m2 = await apply(ctx, edit, runners);
  assert.match(await readFile(join(claudeAgents, "forge-reviewer.md"), "utf8"), /v2/);
  const r = await undo(ctx, m2.id, runners);
  assert.equal(r.restored.length, 2);
  assert.equal(await readFile(join(claudeAgents, "forge-reviewer.md"), "utf8"), v1);

  // Undo the first apply → files gone, user's own agent untouched.
  await undo(ctx, applied.id, runners);
  assert.ok(!(await exists(join(claudeAgents, "forge-reviewer.md"))));
  assert.ok(!(await exists(join(codexAgents, "forge-reviewer.toml"))));
  assert.equal(await readFile(join(claudeAgents, "mine.md"), "utf8"), "---\nname: mine\n---\nMine.\n");
  assert.equal((await history(ctx)).filter((h) => h.undoneAt).length, 2);
  await assert.rejects(undo(ctx, applied.id, runners), /already undone/);
});

test("deleting an agent removes the files it created", async () => {
  await saveAgent(ctx, reviewer);
  await apply(ctx, await preview(ctx, runners), runners);
  await deleteAgent(ctx, reviewer.name);
  const set = await preview(ctx, runners);
  assert.deepEqual(set.changes.map((c) => c.action), ["delete", "delete"]);
  const m = await apply(ctx, set, runners);
  assert.ok(!(await exists(join(claudeAgents, "forge-reviewer.md"))));
  await undo(ctx, m.id, runners);
  assert.ok(await exists(join(claudeAgents, "forge-reviewer.md")));
});

test("refuses to apply when a file changed after the preview", async () => {
  await saveAgent(ctx, reviewer);
  const set = await preview(ctx, runners);
  await put(join(claudeAgents, "forge-reviewer.md"), "user wrote this meanwhile\n");
  await assert.rejects(apply(ctx, set, runners), ConflictError);
  assert.equal(await readFile(join(claudeAgents, "forge-reviewer.md"), "utf8"), "user wrote this meanwhile\n");
});

test("flags overwriting a file Kitroom did not create", async () => {
  await put(join(claudeAgents, "forge-reviewer.md"), "---\nname: forge-reviewer\n---\nUser's own.\n");
  await saveAgent(ctx, reviewer);
  const set = await preview(ctx, runners);
  const c = set.changes.find((x) => x.path.endsWith("forge-reviewer.md"))!;
  assert.equal(c.action, "modify");
  assert.equal(c.unmanagedOverwrite, true);
});

test("undo keeps files the user edited after the apply", async () => {
  await saveAgent(ctx, reviewer);
  const m = await apply(ctx, await preview(ctx, runners), runners);
  await put(join(claudeAgents, "forge-reviewer.md"), "edited by user\n");
  const r = await undo(ctx, m.id, runners);
  assert.deepEqual(r.skipped, [join(claudeAgents, "forge-reviewer.md")]);
  assert.equal(await readFile(join(claudeAgents, "forge-reviewer.md"), "utf8"), "edited by user\n");
  assert.ok(!(await exists(join(codexAgents, "forge-reviewer.toml"))));
});

test("never writes outside agent folders or to credential files", () => {
  assert.throws(() => assertWritable(ctx, join(toolHome(), ".codex", "auth.json")));
  assert.throws(() => assertWritable(ctx, join(toolHome(), ".claude.json")));
  assert.throws(() => assertWritable(ctx, join(claudeAgents, "..", "settings.json")));
  assert.throws(() => assertWritable(ctx, claudeAgents));
  assert.doesNotThrow(() => assertWritable(ctx, join(claudeAgents, "x.md")));
});

test("credential and account files are untouched after a full cycle", async () => {
  await saveAgent(ctx, reviewer);
  const m = await apply(ctx, await preview(ctx, runners), runners);
  await undo(ctx, m.id, runners);
  assert.equal(await readFile(join(toolHome(), ".codex", "auth.json"), "utf8"), '{"OPENAI_API_KEY":"x"}');
  assert.equal(await readFile(join(toolHome(), ".claude.json"), "utf8"), '{"oauthAccount":{}}');
});

// ---------------------------------------------------------------------------
// skills

const lint = { name: "forge-lint", description: "Run the linter", body: "Run `npm run lint`.", targets: ["claude", "codex"] as ("claude" | "codex")[] };
const claudeSkill = () => join(toolHome(), ".claude", "skills", "forge-lint", "SKILL.md");
const codexSkill = () => join(toolHome(), ".agents", "skills", "forge-lint", "SKILL.md");

test("skills: store round-trip and reserved names", async () => {
  await saveSkill(ctx, lint);
  assert.deepEqual(await listSkills(ctx), [{ ...lint, body: "Run `npm run lint`.\n" }]);
  await assert.rejects(saveSkill(ctx, { ...lint, name: "synced" }), /reserved/);
  await assert.rejects(saveSkill(ctx, { ...lint, name: "a/b" }), /Name must/);
});

test("skills: apply creates SKILL.md for Claude and Codex, delete removes the folders", async () => {
  await put(join(toolHome(), ".claude", "skills", "my-own", "SKILL.md"), "---\nname: my-own\n---\nmine\n");
  await saveSkill(ctx, lint);
  const set = await preview(ctx, runners);
  assert.deepEqual(
    set.changes.map((c) => [c.path, c.action]),
    [
      [codexSkill(), "create"],
      [claudeSkill(), "create"],
    ].sort((a, b) => a[0].localeCompare(b[0])),
  );
  await apply(ctx, set, runners);
  assert.match(await readFile(claudeSkill(), "utf8"), /Run the linter/);
  assert.ok(await exists(codexSkill()));

  await deleteSkill(ctx, lint.name);
  const del = await apply(ctx, await preview(ctx, runners), runners);
  assert.equal(del.entries.length, 2);
  assert.ok(!(await exists(dirname(claudeSkill()))), "empty skill folder should be removed");
  assert.ok(!(await exists(dirname(codexSkill()))));
  assert.ok(await exists(join(toolHome(), ".claude", "skills", "my-own", "SKILL.md")), "user's own skill must stay");

  await undo(ctx, del.id, runners);
  assert.ok(await exists(claudeSkill()));
});

test("skills: undo of a create removes the skill folder", async () => {
  await saveSkill(ctx, lint);
  const m = await apply(ctx, await preview(ctx, runners), runners);
  await undo(ctx, m.id, runners);
  assert.ok(!(await exists(dirname(claudeSkill()))));
  assert.ok(await exists(join(toolHome(), ".claude")), "tool folder itself stays");
});

test("never writes into claude.ai synced skills", () => {
  const synced = join(toolHome(), ".claude", "skills", "synced", "bucket", "x", "SKILL.md");
  assert.throws(() => assertWritable(ctx, synced), /managed by another app/);
  assert.doesNotThrow(() => assertWritable(ctx, claudeSkill()));
  assert.doesNotThrow(() => assertWritable(ctx, codexSkill()));
});
