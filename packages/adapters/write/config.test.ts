// Global rule and MCP servers: import → preview → apply → undo, with a fake Claude CLI.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MASK } from "@agent-forge/model";
import type { PathContext } from "../types";
import type { ClaudeCliRunner } from "./claude-mcp";
import { deleteMcpServer, readManagedMcp, readManagedRule, saveManagedRule, saveMcpServer } from "./config-store";
import { displayChangeSet } from "./display";
import { importMcp, importRule } from "./import";
import { nodeWorkerRunner } from "./node-runner";
import { apply, ConflictError, preview, undo, type PipelineRunners } from "./pipeline";

let root: string, home: string, ctx: PathContext;
const claudeJson = () => join(home, ".claude.json");
const codexConfig = () => join(home, ".codex", "config.toml");
const calls: string[][] = [];

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Emulates `claude mcp add-json <name> - -s user` / `claude mcp remove <name> -s user` on the fake home. */
const fakeClaude: ClaudeCliRunner = async (args, stdin) => {
  calls.push(args);
  const data = JSON.parse(await readFile(claudeJson(), "utf8"));
  data.mcpServers ??= {};
  const [, cmd, name] = args;
  if (cmd === "remove") {
    if (!data.mcpServers[name]) throw new Error(`No MCP server named ${name}`);
    delete data.mcpServers[name];
  } else if (cmd === "add-json") {
    if (data.mcpServers[name]) throw new Error(`${name} already exists`);
    data.mcpServers[name] = JSON.parse(stdin!);
  } else throw new Error(`unexpected ${args.join(" ")}`);
  await writeFile(claudeJson(), JSON.stringify(data));
};

const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: fakeClaude };
const claudeServers = async () => JSON.parse(await readFile(claudeJson(), "utf8")).mcpServers ?? {};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-config-"));
  home = join(root, "home");
  ctx = { home, project: "", env: {} };
  calls.length = 0;
  await put(join(home, ".claude", "CLAUDE.md"), "# Claude rules\nBe concise.\n");
  await put(join(home, ".codex", "AGENTS.md"), "# Codex rules\n");
  await put(
    claudeJson(),
    JSON.stringify({
      oauthAccount: { emailAddress: "someone@example.invalid" },
      numStartups: 3,
      mcpServers: { github: { type: "stdio", command: "npx", args: ["-y", "gh-mcp"], env: { GITHUB_TOKEN: "SECRET_GH" } } },
    }),
  );
  await put(
    codexConfig(),
    'model = "gpt-5"\napproval_policy = "on-request"\n\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n\n[mcp_servers.context7.env]\nAPI_KEY = "SECRET_C7"\n\n[profiles.fast]\nmodel = "mini"\n',
  );
});

afterEach(() => rm(root, { recursive: true, force: true }));

test("nothing is generated for rules or MCP until they are managed", async () => {
  const set = await preview(ctx, runners);
  assert.deepEqual(set.changes, []);
  assert.deepEqual(set.commands, []);
});

test("rule: import keeps Claude's text and reports the difference", async () => {
  const r = await importRule(ctx);
  assert.deepEqual(r, { from: "claude", differs: true });
  assert.equal((await readManagedRule(ctx))?.body, "# Claude rules\nBe concise.\n");
  const set = await preview(ctx, runners);
  assert.deepEqual(
    set.changes.filter((c) => c.action !== "unchanged").map((c) => [c.path, c.action]),
    [[join(home, ".codex", "AGENTS.md"), "modify"]],
    "CLAUDE.md is unchanged, AGENTS.md gets Claude's text",
  );
});

test("rule: edit → apply → undo restores both files", async () => {
  await importRule(ctx);
  await saveManagedRule(ctx, { body: "# Shared rules\nUse TypeScript.\n", targets: ["claude", "codex"] });
  const m = await apply(ctx, await preview(ctx, runners), runners);
  assert.equal(await readFile(join(home, ".claude", "CLAUDE.md"), "utf8"), "# Shared rules\nUse TypeScript.\n");
  assert.equal(await readFile(join(home, ".codex", "AGENTS.md"), "utf8"), "# Shared rules\nUse TypeScript.\n");
  await undo(ctx, m.id, runners);
  assert.equal(await readFile(join(home, ".claude", "CLAUDE.md"), "utf8"), "# Claude rules\nBe concise.\n");
  assert.equal(await readFile(join(home, ".codex", "AGENTS.md"), "utf8"), "# Codex rules\n");
});

test("mcp: import brings in both tools' servers; applying right away changes nothing", async () => {
  const r = await importMcp(ctx);
  assert.deepEqual(r, { added: ["context7", "github"], conflicts: [] });
  const set = await preview(ctx, runners);
  assert.ok(set.changes.every((c) => c.action === "unchanged"), JSON.stringify(set.changes.map((c) => [c.path, c.action])));
  assert.ok(set.commands.every((c) => c.action === "unchanged"));
  assert.deepEqual(set.warnings, []);
});

test("mcp: add a server for both tools → config.toml merged, Claude via CLI; undo reverts", async () => {
  await importMcp(ctx);
  await saveMcpServer(ctx, { name: "playwright", transport: "stdio", command: "npx", args: ["@playwright/mcp"], targets: ["claude", "codex"] });
  const set = await preview(ctx, runners);

  const toml = set.changes.find((c) => c.path === codexConfig())!;
  assert.equal(toml.action, "modify");
  assert.equal(toml.merged, true);
  assert.match(toml.after!, /model = "gpt-5"/);
  assert.match(toml.after!, /\[profiles\.fast\]/);
  assert.match(toml.after!, /\[mcp_servers\.playwright\]/);
  assert.match(toml.after!, /\[mcp_servers\.context7\]/);
  assert.deepEqual(set.commands.filter((c) => c.action !== "unchanged").map((c) => [c.name, c.action]), [["playwright", "add"]]);

  const m = await apply(ctx, set, runners);
  assert.deepEqual(calls, [["mcp", "add-json", "playwright", "-", "-s", "user"]], "JSON goes through stdin");
  assert.ok((await claudeServers()).playwright);
  const json = JSON.parse(await readFile(claudeJson(), "utf8"));
  assert.equal(json.oauthAccount.emailAddress, "someone@example.invalid", "account data untouched");
  assert.equal(json.numStartups, 3);

  await undo(ctx, m.id, runners);
  assert.equal((await claudeServers()).playwright, undefined);
  assert.doesNotMatch(await readFile(codexConfig(), "utf8"), /playwright/);
  assert.match(await readFile(codexConfig(), "utf8"), /approval_policy/);
});

test("mcp: removing a server and editing env keep secrets when masked values are sent back", async () => {
  await importMcp(ctx);
  const stored = (await readManagedMcp(ctx))!.find((s) => s.name === "github")!;
  // The renderer only ever sees masked values; sending them back keeps the originals.
  await saveMcpServer(ctx, { ...stored, env: { GITHUB_TOKEN: MASK }, args: stored.args }, "github");
  assert.equal((await readManagedMcp(ctx))!.find((s) => s.name === "github")!.env!.GITHUB_TOKEN, "SECRET_GH");
  await assert.rejects(saveMcpServer(ctx, { ...stored, name: "new", env: { NEW: MASK } }), /Enter a value/);

  await deleteMcpServer(ctx, "context7");
  const set = await preview(ctx, runners);
  const toml = set.changes.find((c) => c.path === codexConfig())!;
  assert.doesNotMatch(toml.after!, /context7/);
  assert.match(toml.after!, /model = "gpt-5"/);
});

test("mcp: servers added outside Agent Forge are flagged before they would be removed", async () => {
  await importMcp(ctx);
  const data = JSON.parse(await readFile(claudeJson(), "utf8"));
  data.mcpServers.sentry = { type: "stdio", command: "sentry-mcp" };
  await writeFile(claudeJson(), JSON.stringify(data));
  const set = await preview(ctx, runners);
  assert.deepEqual(set.warnings, [{ kind: "unmanaged-mcp", tool: "claude", names: ["sentry"] }]);
  assert.deepEqual(set.commands.find((c) => c.name === "sentry")?.action, "remove");
  // Re-import adds it, so nothing is removed any more.
  await importMcp(ctx);
  assert.deepEqual((await preview(ctx, runners)).warnings, []);
});

test("mcp: refuses to apply when Claude's servers changed after the preview", async () => {
  await importMcp(ctx);
  await saveMcpServer(ctx, { name: "x", transport: "stdio", command: "x", targets: ["claude"] });
  const set = await preview(ctx, runners);
  const data = JSON.parse(await readFile(claudeJson(), "utf8"));
  data.mcpServers.x = { type: "stdio", command: "someone-else" };
  await writeFile(claudeJson(), JSON.stringify(data));
  await assert.rejects(apply(ctx, set, runners), ConflictError);
});

test("mcp: blocked without the Claude CLI", async () => {
  await importMcp(ctx);
  await saveMcpServer(ctx, { name: "x", transport: "stdio", command: "x", targets: ["claude"] });
  const set = await preview(ctx, { ...runners, claude: null });
  assert.equal(set.blocked, "not-found");
  await assert.rejects(apply(ctx, set, { claude: null }), /cannot be used/);
  const inside = await preview(ctx, { ...runners, claude: null, claudeUnavailable: "inside-session" });
  assert.equal(inside.blocked, "inside-session");
});

test("display copy of a preview never contains secrets", async () => {
  await importMcp(ctx);
  await saveMcpServer(ctx, { name: "y", transport: "http", url: "https://y.example.invalid/mcp?key=SECRET_Q", headers: { Authorization: "SECRET_H" }, targets: ["claude", "codex"] });
  const set = await preview(ctx, runners);
  const shown = JSON.stringify(displayChangeSet(set, (p) => p === codexConfig()));
  for (const s of ["SECRET_GH", "SECRET_C7", "SECRET_Q", "SECRET_H"]) assert.ok(!shown.includes(s), `${s} leaked`);
  assert.ok(JSON.stringify(set).includes("SECRET_Q"), "the real set keeps values for applying");
});

test("managed MCP file and backups are private to the user", { skip: process.platform === "win32" }, async () => {
  await importMcp(ctx);
  const mode = (await stat(join(home, ".agent-forge", "source", "mcp.jsonc"))).mode & 0o777;
  assert.equal(mode, 0o600);
  await saveMcpServer(ctx, { name: "z", transport: "stdio", command: "z", targets: ["codex"] });
  const m = await apply(ctx, await preview(ctx, runners), runners);
  const dir = join(home, ".agent-forge", "backups", m.id);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dir, "manifest.json"))).mode & 0o777, 0o600);
});

test("mcp: a failed CLI command rolls back files and earlier commands", async () => {
  await importMcp(ctx);
  await saveMcpServer(ctx, { name: "aaa", transport: "stdio", command: "a", targets: ["claude", "codex"] });
  await saveMcpServer(ctx, { name: "zzz", transport: "stdio", command: "z", targets: ["claude"] });
  const before = await readFile(codexConfig(), "utf8");
  const set = await preview(ctx, runners);
  const failing: ClaudeCliRunner = async (args, stdin) => {
    if (args[2] === "zzz") throw new Error("boom");
    return fakeClaude(args, stdin);
  };
  await assert.rejects(apply(ctx, set, { claude: failing }), /boom/);
  assert.equal((await claudeServers()).aaa, undefined, "earlier command rolled back");
  assert.equal(await readFile(codexConfig(), "utf8"), before, "config.toml restored");
});

test("mcp: Codex-only fields (timeouts, enabled = false) survive import, edit and apply", async () => {
  await put(
    codexConfig(),
    'model = "gpt-5"\n\n[mcp_servers.slow]\ncommand = "slow-mcp"\nstartup_timeout_sec = 20\ntool_timeout_sec = 90\nenabled = false\nbearer_token_env_var = "SECRET_BT"\n\n[mcp_servers.remote]\nurl = "https://example.invalid/mcp"\nbearer_token_env_var = "SECRET_RT"\n',
  );
  await importMcp(ctx);
  const [slow] = (await readManagedMcp(ctx))!.filter((s) => s.name === "slow");
  assert.deepEqual(slow.codexExtra, { startup_timeout_sec: 20, tool_timeout_sec: 90, enabled: false, bearer_token_env_var: "SECRET_BT" });

  // The renderer sees the extras masked and sends them back masked: the stored values are kept.
  const { maskManagedMcp } = await import("@agent-forge/model");
  const masked = maskManagedMcp(slow);
  assert.equal(masked.codexExtra?.bearer_token_env_var, MASK);
  assert.equal(masked.codexExtra?.startup_timeout_sec, 20);
  await saveMcpServer(ctx, { ...masked, args: ["--verbose"] }, "slow");
  assert.equal((await readManagedMcp(ctx))!.find((s) => s.name === "slow")?.codexExtra?.bearer_token_env_var, "SECRET_BT");

  const set = await preview(ctx, runners);
  const change = set.changes.find((c) => c.path === codexConfig())!;
  const { parse } = await import("smol-toml");
  const after = parse(change.after!) as { model: string; mcp_servers: Record<string, Record<string, unknown>> };
  assert.equal(after.model, "gpt-5");
  assert.deepEqual({ ...after.mcp_servers.slow }, {
    command: "slow-mcp",
    args: ["--verbose"],
    startup_timeout_sec: 20,
    tool_timeout_sec: 90,
    enabled: false,
  });
  // Codex rejects bearer_token_env_var on stdio servers (rulesync drops it); url servers keep it.
  assert.deepEqual({ ...after.mcp_servers.remote }, { url: "https://example.invalid/mcp", bearer_token_env_var: "SECRET_RT" });
  // The diff the renderer gets hides secret-looking fields on both sides.
  const shown = displayChangeSet(set, (p) => p === codexConfig()).changes.find((c) => c.path === codexConfig())!;
  assert.ok(!/SECRET_(BT|RT)/.test(shown.before!) && !/SECRET_(BT|RT)/.test(shown.after!));
});

test("rule: warns when AGENTS.override.md would shadow the Codex rule", async () => {
  await importRule(ctx);
  assert.deepEqual((await preview(ctx, runners)).warnings, []);
  await put(join(home, ".codex", "AGENTS.override.md"), "# override\n");
  assert.deepEqual((await preview(ctx, runners)).warnings, [
    { kind: "codex-rule-override", path: join(home, ".codex", "AGENTS.override.md") },
  ]);
  await saveManagedRule(ctx, { body: "x", targets: ["claude"] });
  assert.deepEqual((await preview(ctx, runners)).warnings, []);
});
