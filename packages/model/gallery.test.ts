import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadGallery, parseTemplate, uniqueName } from "./gallery";

const GALLERY = join(import.meta.dirname, "../../gallery");

function galleryFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of readdirSync(GALLERY, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(GALLERY, dir.name))) files[`gallery/${dir.name}/${f}`] = readFileSync(join(GALLERY, dir.name, f), "utf8");
  }
  return files;
}

test("every shipped template parses and has both languages", () => {
  const all = loadGallery(galleryFiles());
  const count = (k: string) => all.filter((t) => t.kind === k).length;
  assert.ok(count("agent") >= 1 && count("skill") >= 1 && count("rule") >= 1 && count("mcp") >= 1 && count("permissions") >= 1 && count("hook") >= 1);
  assert.equal(all.length, Object.keys(galleryFiles()).length, "every file is a template");
  for (const t of all) {
    assert.ok(t.title.ko && t.title.en && t.summary.ko && t.summary.en, t.id);
  }
});

test("shipped templates contain no secrets", () => {
  const SECRET = /(ghp_|github_pat_|sk-[A-Za-z0-9]|xox[abp]-|AKIA[0-9A-Z]{12}|-----BEGIN)/;
  for (const [path, text] of Object.entries(galleryFiles())) assert.doesNotMatch(text, SECRET, path);
  for (const t of loadGallery(galleryFiles())) {
    if (t.kind !== "mcp") continue;
    for (const v of [...Object.values(t.server.env ?? {}), ...Object.values(t.server.headers ?? {})]) {
      assert.match(v, /\$\{[A-Z0-9_]+\}/, `${t.id}: env/header values must be \${VAR} references`);
    }
  }
});

test("parses an agent template", () => {
  const t = parseTemplate(
    "agent",
    "x",
    "---\r\nname: x\r\ntitle.en: X\r\ntitle.ko: 엑스\r\nsummary.en: s\r\nsummary.ko: 에스\r\ndescription: d\r\ntools: Read, Grep\r\n---\r\nBody\r\n",
  );
  assert.equal(t.kind, "agent");
  if (t.kind !== "agent") return;
  assert.deepEqual(t.agent, { name: "x", description: "d", body: "Body\n", model: undefined, tools: ["Read", "Grep"] });
});

test("rejects malformed templates", () => {
  const head = "title.en: X\ntitle.ko: 엑스\nsummary.en: s\nsummary.ko: 에스\n";
  assert.throws(() => parseTemplate("agent", "x", "no frontmatter"), /frontmatter/);
  assert.throws(() => parseTemplate("agent", "x", `---\n${head}name: y\ndescription: d\n---\nB`), /match the file name/);
  assert.throws(() => parseTemplate("skill", "x", `---\n${head}name: x\ndescription: d\nmodel: m\n---\nB`), /unknown keys/);
  assert.throws(() => parseTemplate("skill", "x", `---\ntitle.en: X\nsummary.en: s\nsummary.ko: s\nname: x\ndescription: d\n---\nB`), /title/);
  assert.throws(() => parseTemplate("rule", "r", `---\n${head}---\n`), /empty body/);
  assert.throws(() => parseTemplate("skill", "synced", `---\n${head}name: synced\ndescription: d\n---\nB`), /reserved/);
  const mcp = (server: object) => JSON.stringify({ title: { en: "a", ko: "b" }, summary: { en: "a", ko: "b" }, server });
  assert.throws(() => parseTemplate("mcp", "m", mcp({ name: "m", transport: "stdio" })), /command/);
  assert.throws(() => parseTemplate("mcp", "m", mcp({ name: "m", transport: "http", url: "file:///x" })), /url/);
  assert.throws(() => parseTemplate("mcp", "m", mcp({ name: "m", transport: "stdio", command: "x", cwd: "/" })), /unknown server keys/);
  assert.throws(() => loadGallery({ "gallery/agents/bad.md": "x" }), /gallery\/agents\/bad\.md/);
});

test("uniqueName adds a suffix only when needed", () => {
  assert.equal(uniqueName("a", []), "a");
  assert.equal(uniqueName("a", ["a", "a-2"]), "a-3");
});
