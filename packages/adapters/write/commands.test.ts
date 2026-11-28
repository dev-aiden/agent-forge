// Moving custom commands (Claude Code) and prompts (Codex) into skills, and the
// skill fields the form edits (userOnly, argumentHint). Runs in a fake HOME.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PathContext } from "../types";
import { listLegacyCommands, moveCommand } from "./commands";
import { importSkills } from "./import";
import { nodeWorkerRunner } from "./node-runner";
import { apply, preview, undo, type PipelineRunners } from "./pipeline";
import { deleteSkill, listSkills, readRetired, saveSkill } from "./store";

let root: string, home: string, ctx: PathContext;
const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: null };

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const exists = (p: string) => stat(p).then(() => true, () => false);
/** Path below the fake HOME with "/" separators (Windows uses "\\"). */
const rel = (p: string, base = home) => p.slice(base.length).replaceAll("\\", "/");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kitroom-commands-"));
  home = join(root, "home");
  ctx = { home, project: "", env: { KITROOM_HOME: join(root, "forge") } };
});

afterEach(() => rm(root, { recursive: true, force: true }));

const pending = async () => (await preview(ctx, runners)).changes.filter((c) => c.action !== "unchanged");

test("lists commands and prompts with whether they can be moved", async () => {
  await put(join(home, ".claude/commands/review.md"), "---\ndescription: Review a PR\nargument-hint: \"[pr]\"\n---\nReview PR $ARGUMENTS.\n");
  await put(join(home, ".claude/commands/git/commit.md"), "Commit.\n");
  await put(join(home, ".claude/commands/odd.md"), "---\nfoo: bar\n---\nOdd.\n");
  await put(join(home, ".claude/commands/taken.md"), "Taken.\n");
  await put(join(home, ".claude/skills/taken/SKILL.md"), "---\nname: taken\ndescription: x\n---\nx\n");
  await put(join(home, ".codex/prompts/fix.md"), "---\ndescription: Fix\n---\nFix $1.\n");

  const list = await listLegacyCommands(ctx);
  const by = Object.fromEntries(list.map((c) => [`${c.tool}:${c.name}`, c]));
  assert.deepEqual(Object.keys(by).sort(), ["claude:git/commit", "claude:odd", "claude:review", "claude:taken", "codex:fix"]);
  assert.equal(by["claude:review"]!.blocked, undefined);
  assert.equal(by["claude:review"]!.usesArguments, true);
  assert.equal(by["claude:review"]!.verified, false); // ~/.claude/commands is not in the docs
  assert.equal(by["claude:git/commit"]!.blocked, "invalid-name");
  assert.equal(by["claude:odd"]!.blocked, "unsupported-fields");
  assert.equal(by["claude:taken"]!.blocked, "skill-exists");
  assert.equal(by["codex:fix"]!.blocked, undefined);
  assert.equal(by["codex:fix"]!.verified, true);
  await assert.rejects(moveCommand(ctx, "claude", "taken", false), /cannot be moved/);
});

test("moving a Claude command with removal: skill created, original deleted with backup, undo keeps it", async () => {
  const cmdPath = join(home, ".claude/commands/review.md");
  const original = "---\ndescription: Review a PR\nargument-hint: \"[pr]\"\nallowed-tools: Bash(gh:*)\n---\nReview PR $ARGUMENTS.\n";
  await put(cmdPath, original);

  const r = await moveCommand(ctx, "claude", "review", true);
  assert.equal(r.removalPlanned, true);
  assert.equal(r.skill.argumentHint, "[pr]");
  assert.deepEqual(r.skill.targets, ["claude"]);
  assert.deepEqual(r.skill.extra, { claudecode: { "allowed-tools": "Bash(gh:*)" } });
  // Moving only touches Kitroom's own folder.
  assert.equal(await readFile(cmdPath, "utf8"), original);
  assert.equal((await listLegacyCommands(ctx))[0]!.removalPlanned, true);

  const set = await preview(ctx, runners);
  const changes = set.changes.filter((c) => c.action !== "unchanged");
  assert.deepEqual(changes.map((c) => `${c.action} ${rel(c.path)}`), ["delete /.claude/commands/review.md", "create /.claude/skills/review/SKILL.md"]);
  assert.deepEqual(set.warnings, [{ kind: "moved-commands", paths: [cmdPath] }]);
  const skillMd = changes.find((c) => c.action === "create")!.after!;
  assert.match(skillMd, /argument-hint: ['"]\[pr\]['"]/);
  assert.match(skillMd, /allowed-tools: '?Bash\(gh:\*\)'?/);
  assert.match(skillMd, /Review PR \$ARGUMENTS\./);

  const manifest = await apply(ctx, set, runners);
  assert.equal(await exists(cmdPath), false);
  assert.equal(await exists(join(home, ".claude/commands")), true, "the commands folder itself is kept");
  assert.deepEqual(await readRetired(ctx), []);
  assert.deepEqual(await pending(), []);

  await undo(ctx, manifest.id, runners);
  assert.equal(await readFile(cmdPath, "utf8"), original);
  // Undo means "keep it": the next apply recreates the skill but leaves the command.
  assert.deepEqual((await pending()).map((c) => `${c.action} ${rel(c.path)}`), ["create /.claude/skills/review/SKILL.md"]);
});

test("without removal the original stays; a moved file edited since, or a deleted skill, keeps it", async () => {
  await put(join(home, ".claude/commands/keep.md"), "Keep.\n");
  await put(join(home, ".claude/commands/edited.md"), "Edited.\n");
  await put(join(home, ".claude/commands/orphan.md"), "Orphan.\n");
  await moveCommand(ctx, "claude", "keep", false);
  await moveCommand(ctx, "claude", "edited", true);
  await moveCommand(ctx, "claude", "orphan", true);
  await put(join(home, ".claude/commands/edited.md"), "Edited by hand.\n");
  await deleteSkill(ctx, "orphan");

  const set = await preview(ctx, runners);
  assert.deepEqual(set.changes.filter((c) => c.action === "delete"), []);
  assert.deepEqual(set.warnings, []);
  // No description: the first line is used, like Claude Code does.
  assert.equal((await listSkills(ctx)).find((s) => s.name === "keep")!.description, "Keep.");
});

test("moving a Codex prompt makes a skill only run when called", async () => {
  const promptPath = join(home, ".codex/prompts/fix.md");
  await put(promptPath, "---\ndescription: Fix an issue\nargument-hint: ISSUE=<n>\n---\nFix issue $ISSUE.\n");
  const r = await moveCommand(ctx, "codex", "fix", true);
  assert.equal(r.skill.userOnly, true);
  assert.equal(r.usesArguments, true);
  assert.deepEqual(r.skill.targets, ["codex"]);

  // Codex reads "only when called" from the skill's agents/openai.yaml.
  const changes = await pending();
  assert.deepEqual(changes.map((c) => `${c.action} ${rel(c.path)}`), [
    "create /.agents/skills/fix/agents/openai.yaml",
    "create /.agents/skills/fix/SKILL.md",
    "delete /.codex/prompts/fix.md",
  ]);
  assert.match(changes[0]!.after!, /allow_implicit_invocation: false/);
});

test("project scope: a project command moves into the project's skills", async () => {
  const project = join(home, "work", "app");
  await put(join(project, ".claude/commands/deploy.md"), "---\ndescription: Deploy\n---\nDeploy.\n");
  await put(join(home, ".claude/commands/global.md"), "Global.\n");
  ctx = { ...ctx, project };
  assert.deepEqual((await listLegacyCommands(ctx)).map((c) => c.name), ["deploy"]);
  await moveCommand(ctx, "claude", "deploy", true);
  assert.deepEqual((await pending()).map((c) => `${c.action} ${rel(c.path, project)}`), [
    "delete /.claude/commands/deploy.md",
    "create /.claude/skills/deploy/SKILL.md",
  ]);
});

test("skill form fields: only when called, argument hint", async () => {
  await saveSkill(ctx, { name: "release", description: "Cut a release", body: "Release.\n", targets: ["claude", "codex"], userOnly: true, argumentHint: "[version]" });
  const [s] = await listSkills(ctx);
  assert.equal(s!.userOnly, true);
  assert.equal(s!.argumentHint, "[version]");
  assert.equal(s!.extra, undefined);

  const changes = await pending();
  const at = (suffix: string) => changes.find((c) => rel(c.path).endsWith(suffix))!.after!;
  const claude = at("/.claude/skills/release/SKILL.md");
  const codex = at("/.agents/skills/release/SKILL.md");
  const codexPolicy = at("/.agents/skills/release/agents/openai.yaml");
  assert.match(claude, /disable-model-invocation: true/);
  assert.match(claude, /argument-hint: ['"]\[version\]['"]/);
  assert.match(codexPolicy, /allow_implicit_invocation: false/);
  assert.doesNotMatch(codex, /argument-hint/);

  // Turning them off removes them.
  await saveSkill(ctx, { ...s!, userOnly: false, argumentHint: "" }, "release");
  const [off] = await listSkills(ctx);
  assert.equal(off!.userOnly, undefined);
  assert.equal(off!.argumentHint, undefined);
});

test("imported skills with these fields stay unchanged; values the form cannot show are kept", async () => {
  await put(
    join(home, ".claude/skills/a/SKILL.md"),
    "---\nname: a\ndescription: A\ndisable-model-invocation: true\nargument-hint: \"[x]\"\nmodel: sonnet\n---\nA.\n",
  );
  await put(join(home, ".claude/skills/b/SKILL.md"), "---\nname: b\ndescription: B\ndisable-model-invocation: false\n---\nB.\n");
  await importSkills(ctx);
  const skills = await listSkills(ctx);
  const a = skills.find((s) => s.name === "a")!;
  const b = skills.find((s) => s.name === "b")!;
  assert.equal(a.userOnly, true);
  assert.equal(a.argumentHint, "[x]");
  assert.deepEqual(a.extra, { claudecode: { model: "sonnet" } });
  assert.equal(b.userOnly, undefined);
  assert.deepEqual(b.extra, { "disable-model-invocation": false });
  assert.deepEqual(await pending(), []);

  // Saving from the form (no extras sent) keeps them.
  await saveSkill(ctx, { name: "a", description: "A", body: "A.\n", targets: ["claude"], userOnly: true, argumentHint: "[x]" }, "a");
  await saveSkill(ctx, { name: "b", description: "B", body: "B.\n", targets: ["claude"] }, "b");
  assert.deepEqual(await pending(), []);
});
