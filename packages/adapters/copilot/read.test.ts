import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolConfig } from "@kitroom/model";
import { readCopilot } from "./read";

let root: string, home: string, project: string;
let config: ToolConfig;

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "kitroom-copilot-"));
  home = join(root, "home");
  project = join(root, "project");
  const c = join(home, ".copilot");
  await put(join(c, "copilot-instructions.md"), "# Global\n");
  await put(join(c, "agents", "reviewer.agent.md"), "---\ndescription: Reviews code\ntools: [read, search]\n---\nReview.\n");
  await put(join(c, "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: PDFs\n---\nx\n");
  await put(join(c, "mcp-config.json"), JSON.stringify({ mcpServers: { github: { type: "local", command: "gh-mcp", env: { TOKEN: "secret" } }, web: { type: "http", url: "https://x.invalid/mcp" } } }));
  // Login data: never read.
  await put(join(c, "config.json"), JSON.stringify({ logged_in_users: [{ token: "x" }] }));

  await put(join(project, ".github", "copilot-instructions.md"), "# Project\n");
  await put(join(project, ".github", "instructions", "tests.instructions.md"), "---\napplyTo: \"**/*.test.ts\"\n---\nTest well.\n");
  await put(join(project, "AGENTS.md"), "# Agents\n");
  await put(join(project, ".github", "agents", "deployer.agent.md"), "---\nname: deployer\n---\nDeploy.\n");
  await put(join(project, ".github", "mcp.json"), JSON.stringify({ servers: { db: { command: "db-mcp" } } }));

  config = await readCopilot({ home, project, env: {} });
});

after(() => rm(root, { recursive: true, force: true }));

test("copilot: rules from global, project and .github/instructions", () => {
  assert.deepEqual(
    config.rules.map((r) => [r.source.scope, r.name]),
    [["global", "copilot-instructions.md"], ["project", "copilot-instructions.md"], ["project", "AGENTS.md"], ["project", "tests"]],
  );
  assert.ok(config.rules.every((r) => r.source.verified === false));
});

test("copilot: .agent.md agents, skills and both MCP key styles", () => {
  assert.deepEqual(config.agents.map((a) => [a.name, a.source.scope]), [["deployer", "project"], ["reviewer", "global"]]);
  assert.equal(config.agents.find((a) => a.name === "reviewer")?.description, "Reviews code");
  assert.deepEqual(config.skills.map((s) => s.name), ["pdf"]);
  assert.deepEqual(config.mcpServers.map((s) => [s.name, s.transport, s.source.scope]), [["db", "stdio", "project"], ["github", "stdio", "global"], ["web", "http", "global"]]);
});

test("copilot: login file is never read", () => {
  assert.ok(!JSON.stringify(config).includes("logged_in_users"));
  assert.deepEqual(config.issues, []);
});

test("copilot: project items are skipped without a project", async () => {
  const g = await readCopilot({ home, project: "", env: {} });
  assert.ok(g.rules.every((r) => r.source.scope === "global"));
  assert.deepEqual(g.mcpServers.map((s) => s.name), ["github", "web"]);
});
