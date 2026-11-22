// Project scope: originals under ~/.agent-forge/projects/<id>, outputs inside the project folder.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { PathContext } from "../types";
import { readManagedMcp, readManagedRule, saveMcpServer } from "./config-store";
import { displayChangeSet } from "./display";
import { importMcp, importRule } from "./import";
import { nodeWorkerRunner } from "./node-runner";
import { apply, preview, undo, type PipelineRunners } from "./pipeline";
import { forgePaths, listAgents, saveAgent, saveSkill } from "./store";

let root: string, home: string, project: string, ctx: PathContext, globalCtx: PathContext;
const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: null };

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (e.isFile()) out.push(relative(dir, join(e.parentPath, e.name)));
  }
  return out.sort();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-project-"));
  home = join(root, "home");
  project = join(home, "work", "app");
  ctx = { home, project, env: {} };
  globalCtx = { home, project: "", env: {} };
  await put(join(home, ".claude", "CLAUDE.md"), "# Global rules\n");
  await put(join(project, "CLAUDE.md"), "# App rules\n");
  await put(join(project, "src", "index.ts"), "export {};\n");
  await put(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { old: { command: "old-mcp" } }, other: 1 }));
  await put(join(project, ".codex", "config.toml"), 'model = "gpt-5"\n\n[mcp_servers.db]\ncommand = "db-mcp"\n\n[mcp_servers.db.env]\nDB_PASSWORD = "SECRET_DB"\n');
});

afterEach(() => rm(root, { recursive: true, force: true }));

test("project items are stored apart from global ones", async () => {
  await saveAgent(ctx, { name: "rev", description: "Reviews", body: "Review.", targets: ["claude", "codex"] });
  assert.deepEqual((await listAgents(ctx)).map((a) => a.name), ["rev"]);
  assert.deepEqual(await listAgents(globalCtx), []);
  assert.match(forgePaths(ctx).source, /projects[\\/]app-[0-9a-f]{12}[\\/]source$/);
});

test("agents, skills and rule are written into the project, not the home folder", async () => {
  await saveAgent(ctx, { name: "rev", description: "Reviews", body: "Review.", targets: ["claude", "codex"] });
  await saveSkill(ctx, { name: "lint", description: "Lints", body: "Lint.", targets: ["claude", "codex"] });
  assert.deepEqual(await importRule(ctx), { from: "claude", differs: false });
  const homeBefore = await filesUnder(join(home, ".claude"));

  const set = await preview(ctx, runners);
  assert.deepEqual(
    set.changes.filter((c) => c.action !== "unchanged").map((c) => [relative(project, c.path), c.action]),
    [
      [".agents/skills/lint/SKILL.md", "create"],
      [".claude/agents/rev.md", "create"],
      [".claude/skills/lint/SKILL.md", "create"],
      [".codex/agents/rev.toml", "create"],
      ["AGENTS.md", "create"],
    ],
  );
  assert.deepEqual(set.commands, []);
  const manifest = await apply(ctx, set, runners);
  assert.equal(await readFile(join(project, "AGENTS.md"), "utf8"), "# App rules\n");
  assert.deepEqual(await filesUnder(join(home, ".claude")), homeBefore);

  // The global history does not show project applies.
  const { history } = await import("./pipeline");
  assert.equal((await history(globalCtx)).length, 0);
  assert.equal((await history(ctx)).length, 1);

  const undone = await undo(ctx, manifest.id, runners);
  assert.equal(undone.skipped.length, 0);
  assert.deepEqual(await filesUnder(join(project, ".claude")), []);
  assert.equal(await readFile(join(project, "CLAUDE.md"), "utf8"), "# App rules\n");
});

test("MCP: imports project servers, writes .mcp.json and .codex/config.toml keeping other keys", async () => {
  const r = await importMcp(ctx);
  assert.deepEqual(r.added, ["db", "old"]);
  // Servers from the user's global config are not part of a project.
  assert.deepEqual((await readManagedMcp(globalCtx)), null);
  await saveMcpServer(ctx, { name: "web", transport: "http", url: "https://mcp.example.invalid/mcp", headers: { Authorization: "Bearer ${WEB_TOKEN}" }, targets: ["claude"] });

  const set = await preview(ctx, runners);
  assert.deepEqual(set.commands, [], "project scope never runs the Claude CLI");
  const mcpJson = set.changes.find((c) => c.path === join(project, ".mcp.json"))!;
  assert.equal(mcpJson.merged, true);
  const after = JSON.parse(mcpJson.after!);
  assert.equal(after.other, 1);
  // db came from Codex only, so it stays out of Claude's .mcp.json.
  assert.deepEqual(Object.keys(after.mcpServers).sort(), ["old", "web"]);
  const kinds = set.warnings.map((w) => w.kind);
  assert.ok(kinds.includes("project-mcp"));
  // db has a literal password; web uses ${WEB_TOKEN}.
  assert.deepEqual(set.warnings.find((w) => w.kind === "project-mcp-secrets"), { kind: "project-mcp-secrets", names: ["db"] });

  const shown = JSON.stringify(displayChangeSet(set));
  assert.ok(!shown.includes("SECRET_DB"));

  await apply(ctx, set, runners);
  const toml = await readFile(join(project, ".codex", "config.toml"), "utf8");
  assert.ok(toml.includes('model = "gpt-5"') && toml.includes("[mcp_servers.db]"));
});

test("MCP: servers only in the project files are reported before they are removed", async () => {
  await saveMcpServer(ctx, { name: "only", transport: "stdio", command: "x", targets: ["claude", "codex"] });
  const set = await preview(ctx, runners);
  assert.deepEqual(
    set.warnings.filter((w) => w.kind === "unmanaged-mcp"),
    [
      { kind: "unmanaged-mcp", tool: "claude", names: ["old"] },
      { kind: "unmanaged-mcp", tool: "codex", names: ["db"] },
    ],
  );
});

test("rule import reads the project's files", async () => {
  await importRule(ctx);
  assert.equal((await readManagedRule(ctx))?.body, "# App rules\n");
  assert.equal(await readManagedRule(globalCtx), null);
});

test("the home folder and its parents are refused as a project", async () => {
  for (const bad of [home, root]) {
    await assert.rejects(preview({ home, project: bad, env: {} }, runners), /home folder/);
  }
  await assert.rejects(preview({ home, project: join(home, ".agent-forge", "x"), env: {} }, runners), /belongs to Agent Forge/);
});
