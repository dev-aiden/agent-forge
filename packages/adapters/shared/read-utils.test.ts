import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readClaude } from "../claude/read";
import { readCodex } from "../codex/read";
import { Reader, SENSITIVE_FILES } from "./read-utils";

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function snapshot(dir: string, acc = new Map<string, string>()) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await snapshot(p, acc);
    else acc.set(p, `${createHash("sha256").update(await readFile(p)).digest("hex")}:${(await stat(p)).mtimeMs}`);
  }
  return acc;
}

test("credential files of every tool are on the deny list", () => {
  for (const name of [".credentials.json", "auth.json", "config.json", "oauth_creds.json", "google_accounts.json"]) {
    assert.ok(SENSITIVE_FILES.has(name), name);
  }
});

test("Reader refuses to open credential files", async () => {
  const r = new Reader();
  await assert.rejects(r.text("/anywhere/.codex/auth.json"), /refusing to read credential file/);
  await assert.rejects(r.json("/anywhere/.claude/.credentials.json"), /refusing to read credential file/);
});

test("read adapters do not modify any file", async () => {
  const root = await mkdtemp(join(tmpdir(), "kitroom-ro-"));
  try {
    const home = join(root, "home");
    const project = join(root, "project");
    await put(join(home, ".claude", "CLAUDE.md"), "# r");
    await put(join(home, ".claude", "agents", "a.md"), "---\nname: a\n---\nx");
    await put(join(home, ".claude", "skills", "s", "SKILL.md"), "---\nname: s\n---\nx");
    await put(join(home, ".claude.json"), JSON.stringify({ mcpServers: { m: { command: "x" } } }));
    await put(join(home, ".codex", "config.toml"), "[mcp_servers.m]\ncommand = \"x\"\n");
    await put(join(project, "AGENTS.md"), "# p");
    const before = await snapshot(root);
    await readClaude({ home, project, env: {} });
    await readCodex({ home, project, env: {} });
    assert.deepEqual(await snapshot(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
