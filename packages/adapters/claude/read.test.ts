import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolConfig } from "@agent-forge/model";
import { readClaude } from "./read";

let root: string, home: string, project: string;
let config: ToolConfig;

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-claude-"));
  home = join(root, "home");
  project = join(root, "project");
  const c = join(home, ".claude");

  await put(join(c, "CLAUDE.md"), "# Global rules\n");
  await put(join(c, "rules", "testing.md"), "---\ndescription: Testing rules\npaths: [\"**/*.test.ts\"]\n---\nWrite tests.\n");
  await put(join(c, "agents", "reviewer.md"), "---\nname: code-reviewer\ndescription: Reviews code\ntools: Read, Grep, Glob\nmodel: sonnet\ncolor: blue\n---\nYou review code.\n");
  await put(join(c, "agents", "team", "planner.md"), "No frontmatter here.\n");
  await put(join(c, "agents", "broken.md"), "---\nname: [unclosed\n---\nbody\n");
  await put(join(c, "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: Work with PDFs\nlicense: MIT\n---\n# PDF\n");
  await put(join(c, "skills", "pdf", "scripts", "extract.py"), "print(1)\n");
  await put(join(c, "skills", "pdf", "reference.md"), "ref\n");
  await put(join(c, "skills", "not-a-skill", "README.md"), "no SKILL.md\n");
  await put(join(c, "skills", "synced", "bucket", "morning", "SKILL.md"), "---\nname: morning\n---\nbrief\n");
  await put(join(c, ".credentials.json"), "{\"token\":\"x\"}");
  await put(
    join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: { emailAddress: "someone@example.invalid" },
      mcpServers: {
        github: { type: "stdio", command: "npx", args: ["-y", "gh-mcp"], env: { GITHUB_TOKEN: "secret" } },
        remote: { type: "http", url: "https://mcp.example.invalid/mcp", headers: { Authorization: "Bearer x" } },
      },
      projects: { [project]: { mcpServers: { localdb: { command: "db-mcp" } } }, "/other": { mcpServers: { other: { command: "x" } } } },
    }),
  );

  await put(join(project, "CLAUDE.md"), "# Project rules\n");
  await put(join(project, "CLAUDE.local.md"), "# My notes\n");
  await put(join(project, ".claude", "agents", "deployer.md"), "---\nname: deployer\n---\nDeploy.\n");
  await put(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { playwright: { command: "npx", args: ["@playwright/mcp"] } } }));

  config = await readClaude({ home, project, env: {} });
});

after(() => rm(root, { recursive: true, force: true }));

test("reads root rules with scope and rule files with globs", () => {
  const roots = config.rules.filter((r) => r.root).map((r) => [r.source.scope, r.name]);
  assert.deepEqual(roots, [["global", "CLAUDE.md"], ["project", "CLAUDE.md"], ["local", "CLAUDE.local.md"]]);
  const testing = config.rules.find((r) => r.name === "testing");
  assert.equal(testing?.description, "Testing rules");
  assert.deepEqual(testing?.globs, ["**/*.test.ts"]);
  assert.equal(testing?.body, "Write tests.\n");
});

test("reads agents with frontmatter, nested files and fallbacks", () => {
  const reviewer = config.agents.find((a) => a.name === "code-reviewer");
  assert.ok(reviewer);
  assert.equal(reviewer.description, "Reviews code");
  assert.deepEqual(reviewer.tools, ["Read", "Grep", "Glob"]);
  assert.equal(reviewer.model, "sonnet");
  assert.deepEqual(reviewer.extra, { color: "blue" });
  assert.equal(reviewer.body, "You review code.\n");

  const planner = config.agents.find((a) => a.name === "planner");
  assert.equal(planner?.body, "No frontmatter here.\n");

  assert.ok(config.agents.some((a) => a.name === "deployer" && a.source.scope === "project"));
});

test("records invalid frontmatter as an issue but keeps the item", () => {
  assert.ok(config.agents.some((a) => a.name === "broken"));
  assert.ok(config.issues.some((i) => i.path.endsWith("broken.md") && i.message === "invalid frontmatter"));
});

test("reads skills with bundled files, including synced skills", () => {
  const pdf = config.skills.find((s) => s.name === "pdf");
  assert.ok(pdf);
  assert.equal(pdf.description, "Work with PDFs");
  assert.deepEqual(pdf.files.sort(), ["reference.md", "scripts/extract.py"]);
  assert.deepEqual(pdf.extra, { license: "MIT" });
  assert.ok(!config.skills.some((s) => s.name === "not-a-skill"));

  const morning = config.skills.find((s) => s.name === "morning");
  assert.equal(morning?.extra.managedBy, "claude.ai");
});

test("reads MCP servers from user, local and project scope only", () => {
  const servers = config.mcpServers.map((s) => [s.name, s.source.scope, s.transport]);
  assert.deepEqual(servers, [
    ["github", "global", "stdio"],
    ["localdb", "local", "stdio"],
    ["playwright", "project", "stdio"],
    ["remote", "global", "http"],
  ]);
  const github = config.mcpServers.find((s) => s.name === "github");
  assert.deepEqual(github?.args, ["-y", "gh-mcp"]);
  assert.deepEqual(github?.env, { GITHUB_TOKEN: "secret" });
});

test("never surfaces account info from ~/.claude.json", () => {
  assert.ok(!JSON.stringify(config).includes("someone@example.invalid"));
});
