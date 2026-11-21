// Verifies the scanner against a fake home/project built in a temp directory:
// every tool is detected, secrets never appear in the output, and no file is modified.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatText, scan, type ScanResult } from "./scan";

const SECRET = "SECRET_TOKEN_DO_NOT_PRINT";
const EMAIL = "leak@example.invalid";

let root: string;
let home: string;
let project: string;
let result: ScanResult;
let snapshotBefore: Map<string, string>;

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function snapshot(dir: string, acc = new Map<string, string>()) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await snapshot(p, acc);
    else {
      const st = await stat(p);
      const hash = createHash("sha256").update(await readFile(p)).digest("hex");
      acc.set(p, `${hash}:${st.mtimeMs}`);
    }
  }
  return acc;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-scan-"));
  home = join(root, "home");
  project = join(root, "project");

  // Claude Code
  await put(join(home, ".claude/CLAUDE.md"), "# rules");
  await put(join(home, ".claude/agents/reviewer.md"), "---\nname: reviewer\n---");
  await put(join(home, ".claude/agents/nested/planner.md"), "---\nname: planner\n---");
  await put(join(home, ".claude/skills/pdf/SKILL.md"), "---\nname: pdf\n---");
  await put(join(home, ".claude/skills/synced/bucket-1/morning/SKILL.md"), "---\nname: morning\n---");
  await put(join(home, ".claude/.credentials.json"), JSON.stringify({ token: SECRET }));
  await put(
    join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: { emailAddress: EMAIL, accessToken: SECRET },
      mcpServers: { github: { command: "gh", env: { TOKEN: SECRET } } },
      projects: { [project]: { mcpServers: { localdb: { command: "db" } } } },
    }),
  );
  await put(join(home, ".claude/settings.json"), JSON.stringify({ hooks: {}, env: { API_KEY: SECRET } }));
  await put(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { playwright: {} } }));
  await put(join(project, "CLAUDE.md"), "# project rules");

  // Codex CLI
  await put(join(home, ".codex/AGENTS.md"), "# codex rules");
  await put(join(home, ".codex/auth.json"), JSON.stringify({ OPENAI_API_KEY: SECRET }));
  await put(
    join(home, ".codex/config.toml"),
    `model = "x"\n[mcp_servers.context7]\ncommand = "npx"\n[mcp_servers.context7.env]\nKEY = "${SECRET}"\n[mcp_servers."my server"]\ncommand = "y"\n`,
  );
  await put(join(home, ".codex/prompts/fix.md"), "fix it");
  await put(join(home, ".agents/skills/lint/SKILL.md"), "---\nname: lint\n---");
  await put(join(project, "AGENTS.md"), "# shared rules");

  // Copilot CLI
  await put(join(home, ".copilot/config.json"), JSON.stringify({ logged_in_users: [{ token: SECRET }] }));
  await put(join(home, ".copilot/mcp-config.json"), JSON.stringify({ mcpServers: { sentry: {} } }));
  await put(join(home, ".copilot/agents/docs.agent.md"), "---\nname: docs\n---");
  await put(join(project, ".github/copilot-instructions.md"), "# copilot");

  // Antigravity CLI
  await put(join(home, ".gemini/GEMINI.md"), "# gemini");
  await put(join(home, ".gemini/oauth_creds.json"), JSON.stringify({ refresh_token: SECRET }));
  await put(join(home, ".gemini/config/mcp_config.json"), JSON.stringify({ mcpServers: { figma: {} } }));
  await put(join(home, ".gemini/antigravity-cli/skills/deploy/SKILL.md"), "---\nname: deploy\n---");
  await put(join(project, ".agents/rules/style.md"), "---\ntrigger: always_on\n---");

  // Broken JSON must not leak its content through the error message.
  await put(join(project, ".agents/mcp_config.json"), `{ "mcpServers": ${SECRET} }`);

  snapshotBefore = await snapshot(root);
  result = await scan({ home, project, env: { PATH: "" } });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function entry(tool: string, path: string) {
  const e = result.entries.find((x) => x.tool === tool && x.path === path);
  assert.ok(e, `missing entry ${tool} ${path}`);
  return e;
}

test("detects all four tools from config files", () => {
  for (const t of result.tools) assert.equal(t.detected, true, `${t.label} not detected`);
});

test("counts agents and skills", () => {
  assert.equal(entry("claude", join(home, ".claude/agents")).items, 2);
  assert.equal(entry("claude", join(home, ".claude/skills")).items, 1); // synced/ is not a direct skill
  assert.equal(entry("claude", join(home, ".claude/skills/synced")).items, 1);
  assert.equal(entry("codex", join(home, ".agents/skills")).items, 1);
  assert.equal(entry("copilot", join(home, ".copilot/agents")).items, 1);
  assert.equal(entry("antigravity", join(home, ".gemini/antigravity-cli/skills")).items, 1);
});

test("extracts MCP server names only", () => {
  assert.deepEqual(entry("claude", join(home, ".claude.json")).names, ["user:github", "local:localdb"]);
  assert.deepEqual(entry("claude", join(project, ".mcp.json")).names, ["playwright"]);
  assert.deepEqual(entry("codex", join(home, ".codex/config.toml")).names, ["context7", "my server"]);
  assert.deepEqual(entry("copilot", join(home, ".copilot/mcp-config.json")).names, ["sentry"]);
  assert.deepEqual(entry("antigravity", join(home, ".gemini/config/mcp_config.json")).names, ["figma"]);
});

test("reports parse errors without echoing content", () => {
  const e = entry("antigravity", join(project, ".agents/mcp_config.json"));
  assert.equal(e.error, "parse error");
});

test("never prints secrets or account info", () => {
  for (const out of [JSON.stringify(result), formatText(result, { foundOnly: false })]) {
    assert.ok(!out.includes(SECRET), "secret leaked");
    assert.ok(!out.includes(EMAIL), "email leaked");
  }
});

test("never lists credential files", () => {
  const names = ["auth.json", ".credentials.json", "oauth_creds.json", "config.json"];
  for (const e of result.entries) {
    assert.ok(!names.some((n) => e.path.endsWith("/" + n) || e.path.endsWith("\\" + n)), `credential file listed: ${e.path}`);
  }
});

test("does not modify any file", async () => {
  const snapshotAfter = await snapshot(root);
  assert.deepEqual(snapshotAfter, snapshotBefore);
});
