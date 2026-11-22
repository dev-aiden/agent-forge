import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolConfig } from "@agent-forge/model";
import { readAntigravity } from "./read";

let root: string, home: string, project: string;
let config: ToolConfig;

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-agy-"));
  home = join(root, "home");
  project = join(root, "project");
  const g = join(home, ".gemini");
  await put(join(g, "GEMINI.md"), "# Global\n");
  await put(join(g, "config", "rules", "style.md"), "---\ndescription: Style\n---\nBe tidy.\n");
  await put(join(g, "config", "agents", "planner.md"), "---\nname: planner\ndescription: Plans\n---\nPlan.\n");
  await put(join(g, "antigravity-cli", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Deploys\n---\nx\n");
  await put(join(g, "config", "mcp_config.json"), JSON.stringify({ mcpServers: { remote: { serverUrl: "https://x.invalid/mcp", headers: { Authorization: "Bearer s" } }, off: { command: "x", disabled: true } } }));
  await put(join(g, "oauth_creds.json"), JSON.stringify({ access_token: "x" }));

  await put(join(project, "GEMINI.md"), "# Project\n");
  await put(join(project, ".agents", "rules", "api.md"), "API rules\n");
  await put(join(project, ".agents", "skills", "lint", "SKILL.md"), "---\nname: lint\n---\nx\n");
  await put(join(project, ".agents", "mcp_config.json"), JSON.stringify({ mcpServers: { db: { command: "db-mcp" } } }));

  config = await readAntigravity({ home, project, env: {} });
});

after(() => rm(root, { recursive: true, force: true }));

test("antigravity: rules from GEMINI.md and rule folders", () => {
  assert.deepEqual(
    config.rules.map((r) => [r.source.scope, r.name]),
    [["global", "GEMINI.md"], ["project", "GEMINI.md"], ["global", "style"], ["project", "api"]],
  );
});

test("antigravity: agents, skills and MCP (serverUrl, disabled)", () => {
  assert.deepEqual(config.agents.map((a) => a.name), ["planner"]);
  assert.deepEqual(config.skills.map((s) => [s.name, s.source.scope]), [["deploy", "global"], ["lint", "project"]]);
  const remote = config.mcpServers.find((s) => s.name === "remote");
  assert.equal(remote?.transport, "http");
  assert.equal(remote?.url, "https://x.invalid/mcp");
  assert.equal(config.mcpServers.find((s) => s.name === "off")?.enabled, false);
  assert.ok(config.mcpServers.every((s) => s.source.verified === false));
});

test("antigravity: oauth file is never read", () => {
  assert.ok(!JSON.stringify(config).includes("access_token"));
});
