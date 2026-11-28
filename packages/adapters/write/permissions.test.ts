// Claude Code permission rules in settings.json: import, edit, apply, undo.
// Runs in a fake HOME.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PathContext } from "../types";
import { displayChangeSet } from "./display";
import { nodeWorkerRunner } from "./node-runner";
import {
  importPermissions,
  parsePermission,
  patchClaudeSettings,
  permissionProblem,
  readManagedPermissions,
  saveManagedPermissions,
  unmanagePermissions,
} from "./permissions";
import { apply, preview, undo, type PipelineRunners } from "./pipeline";

let root: string, home: string, ctx: PathContext, settings: string;
const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: null };

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const USER_SETTINGS = `{
  "model": "opus",
  "env": { "GITHUB_TOKEN": "ghp_secret" },
  "permissions": {
    "deny": ["Read(./.env)"],
    "allow": ["Bash(npm test:*)", "Read", "mcp__github__get_issue", "WebFetch(domain:github.com)"],
    "defaultMode": "acceptEdits"
  },
  "hooks": { "Stop": [] }
}
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kitroom-perms-"));
  home = join(root, "home");
  ctx = { home, project: "", env: { KITROOM_HOME: join(root, "forge") } };
  settings = join(home, ".claude/settings.json");
});

afterEach(() => rm(root, { recursive: true, force: true }));

const pending = async () => (await preview(ctx, runners)).changes.filter((c) => c.action !== "unchanged");

test("parses and checks entries the way rulesync writes them", () => {
  assert.deepEqual(parsePermission("Bash(git push:*)"), { tool: "Bash", pattern: "git push:*" });
  assert.deepEqual(parsePermission("Read"), { tool: "Read", pattern: "*" });
  assert.deepEqual(parsePermission("mcp__github__get_issue"), { tool: "mcp__github__get_issue", pattern: "*" });
  assert.equal(parsePermission("Bash()"), null);
  assert.equal(permissionProblem("Bash(rm -rf:*)"), null);
  assert.equal(permissionProblem("WebFetch(domain:github.com)"), null);
  assert.equal(permissionProblem("Bash(*)"), "rewritten"); // written as "Bash"
  assert.equal(permissionProblem("Write(src/**)"), "rewritten"); // written as "Edit(src/**)"
  assert.equal(permissionProblem("not a rule!"), "invalid");
});

test("import then apply changes nothing; other keys, order and formatting are kept", async () => {
  await put(settings, USER_SETTINGS);
  const r = await importPermissions(ctx);
  assert.equal(r.added, 5);
  assert.deepEqual(r.skipped, []);
  const p = (await readManagedPermissions(ctx))!;
  assert.deepEqual([...p.allow].sort(), ["Bash(npm test:*)", "Read", "WebFetch(domain:github.com)", "mcp__github__get_issue"]);
  assert.deepEqual(p.deny, ["Read(./.env)"]);
  assert.deepEqual(await pending(), []);
});

test("editing rules changes only the permission lists; preview masks env; undo restores", async () => {
  await put(settings, USER_SETTINGS);
  await importPermissions(ctx);
  const p = (await readManagedPermissions(ctx))!;
  await saveManagedPermissions(ctx, { allow: p.allow.filter((e) => e !== "Read"), ask: ["Bash(git push:*)"], deny: [...p.deny, "Bash(rm -rf:*)"] });

  const set = await preview(ctx, runners);
  const [change] = set.changes.filter((c) => c.action !== "unchanged");
  assert.equal(change!.path, settings);
  assert.equal(change!.merged, true);
  assert.deepEqual(set.warnings, [{ kind: "removed-permissions", entries: ["Read"] }]);
  const after = JSON.parse(change!.after!);
  assert.equal(after.model, "opus");
  assert.deepEqual(after.hooks, { Stop: [] });
  assert.equal(after.permissions.defaultMode, "acceptEdits");
  assert.equal(after.$schema, undefined, "rulesync's $schema key is not added");
  assert.deepEqual(after.permissions.ask, ["Bash(git push:*)"]);
  assert.deepEqual(after.permissions.deny, ["Bash(rm -rf:*)", "Read(./.env)"]);
  assert.ok(after.permissions.allow.includes("mcp__github__get_issue"));
  assert.ok(!after.permissions.allow.includes("Read"));

  // The renderer never sees the token.
  const shown = displayChangeSet(set).changes.find((c) => c.path === settings)!;
  assert.doesNotMatch(shown.before!, /ghp_secret/);
  assert.doesNotMatch(shown.after!, /ghp_secret/);
  assert.match(shown.after!, /Bash\(git push:\*\)/);

  const manifest = await apply(ctx, set, runners);
  assert.deepEqual(await pending(), []);
  await undo(ctx, manifest.id, runners);
  assert.equal(await readFile(settings, "utf8"), USER_SETTINGS);
});

test("rules for tools Kitroom does not manage are kept; new ones are reported before removal", async () => {
  await saveManagedPermissions(ctx, { allow: [], ask: [], deny: ["Bash(rm -rf:*)"] });
  await put(settings, `{"permissions":{"allow":["Bash(ls:*)","Read(src/**)"]}}`);
  const set = await preview(ctx, runners);
  const after = JSON.parse(set.changes.find((c) => c.path === settings)!.after!);
  // Bash is managed (its entries are replaced); Read is not.
  assert.deepEqual(after.permissions, { allow: ["Read(src/**)"], deny: ["Bash(rm -rf:*)"] });
  assert.deepEqual(set.warnings, [{ kind: "removed-permissions", entries: ["Bash(ls:*)"] }]);
});

test("creates settings.json when missing; project scope writes .claude/settings.json only", async () => {
  await saveManagedPermissions(ctx, { allow: [], ask: [], deny: ["Read(./.env)"] });
  const [c] = await pending();
  assert.equal(c!.action, "create");
  assert.deepEqual(JSON.parse(c!.after!), { permissions: { deny: ["Read(./.env)"] } });

  const project = join(home, "work", "app");
  await put(join(project, ".claude/settings.local.json"), `{"permissions":{"allow":["Bash(ls:*)"]}}`);
  ctx = { ...ctx, project };
  await saveManagedPermissions(ctx, { allow: ["Bash(npm test:*)"], ask: [], deny: [] });
  assert.deepEqual((await pending()).map((x) => x.path.slice(project.length)), ["/.claude/settings.json"]);
});

test("import skips entries it cannot keep, and every entry of their tool", async () => {
  await put(settings, `{"permissions":{"allow":["Bash(*)","Bash(ls:*)","Read(src/**)","Edit(x)"],"deny":["Edit(x)"]}}`);
  const r = await importPermissions(ctx);
  assert.deepEqual(r.skipped, [
    { entry: "Bash(*)", reason: "rewritten" },
    { entry: "Bash(ls:*)", reason: "same-tool" },
    { entry: "Edit(x)", reason: "conflict" },
  ]);
  assert.deepEqual(await readManagedPermissions(ctx), { allow: ["Read(src/**)"], ask: [], deny: [] });
  assert.deepEqual(await pending(), []);
});

test("saving rejects rules rulesync would rewrite and rules in two lists", async () => {
  await assert.rejects(saveManagedPermissions(ctx, { allow: ["Bash(*)"], ask: [], deny: [] }), /written as "Bash"/);
  await assert.rejects(saveManagedPermissions(ctx, { allow: ["Bash(ls:*)"], ask: [], deny: ["Bash(ls:*)"] }), /both allow and deny/);
  await assert.rejects(saveManagedPermissions(ctx, { allow: ["??"], ask: [], deny: [] }), /not a permission rule/);
  await saveManagedPermissions(ctx, { allow: [" Bash(ls:*) ", "Bash(ls:*)", ""], ask: [], deny: [] });
  assert.deepEqual((await readManagedPermissions(ctx))!.allow, ["Bash(ls:*)"]);
  await unmanagePermissions(ctx);
  assert.equal(await readManagedPermissions(ctx), null);
});

test("managing no rules does not create settings.json", async () => {
  const r = await importPermissions(ctx);
  assert.equal(r.added, 0);
  assert.deepEqual(await readManagedPermissions(ctx), { allow: [], ask: [], deny: [] });
  assert.deepEqual(await pending(), []);
});

test("patchClaudeSettings keeps the file when only the order differs", () => {
  const before = `{"permissions":{"allow":["B","A"]}}`;
  assert.equal(patchClaudeSettings(before, `{"$schema":"x","permissions":{"allow":["A","B"]}}`), before);
});

test("every shipped permission template is written the way rulesync writes it", async () => {
  const { readdir, readFile: read } = await import("node:fs/promises");
  const dir = join(import.meta.dirname, "../../../gallery/permissions");
  for (const f of await readdir(dir)) {
    const t = JSON.parse(await read(join(dir, f), "utf8")) as Record<string, string[] | undefined>;
    for (const e of [...(t.allow ?? []), ...(t.ask ?? []), ...(t.deny ?? [])]) assert.equal(permissionProblem(e), null, `${f}: ${e}`);
  }
});
