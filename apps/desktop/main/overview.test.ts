// The overview is what crosses into the renderer: it must never carry secrets.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildOverview, validateProject } from "./overview";

let root: string, home: string, project: string;
const SECRETS = ["SECRET_ARG", "SECRET_ENV", "SECRET_QUERY", "SECRET_HEADER", "SECRET_TOML", "SECRET_EXTRA"];

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-forge-overview-"));
  home = join(root, "home");
  project = join(root, "project");
  await mkdir(project, { recursive: true });
  await put(
    join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: { emailAddress: "someone@example.invalid" },
      mcpServers: {
        a: { command: "npx", args: ["--api-key", "SECRET_ARG"], env: { TOKEN: "SECRET_ENV" }, apiToken: "SECRET_EXTRA" },
        b: { type: "http", url: "https://x.example.invalid/mcp?key=SECRET_QUERY", headers: { Authorization: "SECRET_HEADER" } },
      },
    }),
  );
  await put(join(home, ".codex", "config.toml"), '[mcp_servers.c]\ncommand = "x"\n[mcp_servers.c.env]\nK = "SECRET_TOML"\n');
});

after(() => rm(root, { recursive: true, force: true }));

test("overview contains no secrets or account info", async () => {
  const overview = await buildOverview(project, home, { PATH: "" });
  const json = JSON.stringify(overview);
  for (const s of SECRETS) assert.ok(!json.includes(s), `${s} leaked`);
  assert.ok(!json.includes("someone@example.invalid"));
  const claude = overview.tools.find((t) => t.id === "claude");
  assert.equal(claude?.config?.mcpServers.length, 2);
});

test("undetected tools have no config", async () => {
  const overview = await buildOverview(null, home, { PATH: "" });
  const copilot = overview.tools.find((t) => t.id === "copilot");
  assert.equal(copilot?.detected, false);
  assert.equal(copilot?.config, null);
});

test("validateProject accepts null or an existing absolute directory only", async () => {
  assert.equal(await validateProject(null), null);
  assert.equal(await validateProject(project), project);
  await assert.rejects(validateProject("relative/path"));
  await assert.rejects(validateProject(join(root, "missing")));
  await assert.rejects(validateProject(42));
});
