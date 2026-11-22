import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, readSettings, sanitizeSettings, writeSettings } from "./settings";

test("sanitizeSettings keeps only known values", () => {
  assert.deepEqual(sanitizeSettings({ language: "ko", disabledTools: ["codex", "codex", "bogus", 3] }), {
    language: "ko",
    disabledTools: ["codex"],
  });
  assert.deepEqual(sanitizeSettings({ language: "fr" }), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
});

test("settings round-trip in Agent Forge's own folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-forge-settings-"));
  try {
    const ctx = { home: root, project: "", env: {} };
    assert.deepEqual(await readSettings(ctx), DEFAULT_SETTINGS);
    await writeSettings(ctx, { language: "en", disabledTools: ["claude"], extra: "dropped" });
    assert.deepEqual(await readSettings(ctx), { language: "en", disabledTools: ["claude"] });
    assert.ok(!(await readFile(join(root, ".agent-forge", "settings.json"), "utf8")).includes("dropped"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
