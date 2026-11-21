import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolConfig } from "@agent-forge/model";
import { readCodex } from "./read";

let root: string, home: string, project: string;
let config: ToolConfig;

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-codex-"));
  home = join(root, "home");
  project = join(root, "project");
  const c = join(home, ".codex");

  await put(join(c, "AGENTS.md"), "# Codex global\n");
  await put(join(c, "auth.json"), "{\"OPENAI_API_KEY\":\"x\"}");
  await put(
    join(c, "config.toml"),
    [
      'model = "gpt-5"',
      "[mcp_servers.context7]",
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      "startup_timeout_sec = 20",
      "[mcp_servers.context7.env]",
      'API_KEY = "secret"',
      '[mcp_servers."remote docs"]',
      'url = "https://docs.example.invalid/mcp"',
      'bearer_token_env_var = "DOCS_TOKEN"',
      "enabled = false",
      "",
    ].join("\n"),
  );
  await put(join(c, "agents", "reviewer.toml"), 'name = "reviewer"\ndescription = "Reviews diffs"\nmodel = "gpt-5"\ndeveloper_instructions = "Review carefully."\n');
  await put(join(home, ".agents", "skills", "lint", "SKILL.md"), "---\nname: lint\ndescription: Lint code\n---\nRun lint.\n");
  await put(join(c, "skills", "old", "SKILL.md"), "---\nname: old\n---\nlegacy\n");

  await put(join(project, "AGENTS.md"), "# Project\n");
  await put(join(project, "AGENTS.override.md"), "# Override\n");
  await put(join(project, ".codex", "config.toml"), "[mcp_servers.local]\ncommand = \"local-mcp\"\n");
  await put(join(project, ".codex", "agents", "bad.toml"), "this is = = not toml");

  config = await readCodex({ home, project, env: {} });
});

after(() => rm(root, { recursive: true, force: true }));

test("reads AGENTS.md and AGENTS.override.md as root rules", () => {
  assert.deepEqual(
    config.rules.map((r) => [r.source.scope, r.name, r.root]),
    [
      ["global", "AGENTS.md", true],
      ["project", "AGENTS.override.md", true],
      ["project", "AGENTS.md", true],
    ],
  );
});

test("reads MCP servers from config.toml tables", () => {
  const ctx7 = config.mcpServers.find((s) => s.name === "context7");
  assert.ok(ctx7);
  assert.equal(ctx7.transport, "stdio");
  assert.deepEqual(ctx7.args, ["-y", "@upstash/context7-mcp"]);
  assert.deepEqual(ctx7.env, { API_KEY: "secret" });
  assert.deepEqual(ctx7.extra, { startup_timeout_sec: 20 });

  const remote = config.mcpServers.find((s) => s.name === "remote docs");
  assert.equal(remote?.transport, "http");
  assert.equal(remote?.enabled, false);
  assert.deepEqual(remote?.extra, { bearer_token_env_var: "DOCS_TOKEN" });

  assert.ok(config.mcpServers.some((s) => s.name === "local" && s.source.scope === "project"));
});

test("reads TOML agents as unverified and reports invalid TOML", () => {
  const reviewer = config.agents.find((a) => a.name === "reviewer");
  assert.equal(reviewer?.body, "Review carefully.");
  assert.equal(reviewer?.source.verified, false);
  assert.ok(config.issues.some((i) => i.path.endsWith("bad.toml") && i.message === "invalid TOML"));
});

test("reads skills from ~/.agents/skills and the legacy location", () => {
  assert.deepEqual(config.skills.map((s) => s.name), ["lint", "old"]);
  assert.equal(config.skills.find((s) => s.name === "old")?.extra.legacyLocation, true);
});

test("skips project scope when no project is selected", async () => {
  const global = await readCodex({ home, project: "", env: {} });
  const items = [...global.rules, ...global.agents, ...global.skills, ...global.mcpServers];
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.source.scope === "global"), "only global items expected");
});
