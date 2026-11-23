// Brings the current global rule / MCP servers of each tool into Agent Forge, so
// that applying (which replaces the whole MCP list and the root rule file) keeps
// what the user already has.
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MANAGED_NAME,
  RESERVED_SKILL_NAMES,
  WRITABLE_AGENT_TOOLS,
  type Agent,
  type ManagedAgent,
  type ManagedMcpServer,
  type ManagedSkill,
  type McpServer,
  type Skill,
  type ToolId,
} from "@agent-forge/model";
import { claudePaths } from "../claude/paths";
import { readClaude } from "../claude/read";
import { codexPaths } from "../codex/paths";
import { readCodex } from "../codex/read";
import { Reader } from "../shared/read-utils";
import type { PathContext } from "../types";
import { claudeDefFromRead, sameDef, toClaudeDef } from "./claude-mcp";
import { codexExtraFrom, readManagedMcp, readManagedRule, saveManagedRule, writeManagedMcp } from "./config-store";
import { forgePaths, listAgents, listSkills, writeAgent, writeSkill } from "./store";

export interface McpImportResult {
  added: string[];
  /** Same name configured differently in Claude Code and Codex: Claude's version was kept. */
  conflicts: string[];
}

function toManaged(s: McpServer, tool: ToolId): ManagedMcpServer {
  return {
    codexExtra: tool === "codex" ? codexExtraFrom(s.extra, s.enabled) : undefined,
    name: s.name,
    transport: s.transport,
    command: s.command,
    args: s.args,
    env: s.env,
    url: s.url,
    headers: s.headers,
    targets: [tool],
  };
}

/**
 * Adds servers Agent Forge does not list yet: Claude Code user scope + Codex global,
 * or in project scope the project's .mcp.json + .codex/config.toml.
 */
export async function importMcp(ctx: PathContext): Promise<McpImportResult> {
  const scope = ctx.project ? "project" : "global";
  const found: [ToolId, McpServer[]][] = [
    ["claude", (await readClaude(ctx)).mcpServers.filter((s) => s.source.scope === scope)],
    ["codex", (await readCodex(ctx)).mcpServers.filter((s) => s.source.scope === scope)],
  ];

  const existing = (await readManagedMcp(ctx)) ?? [];
  const known = new Set(existing.map((s) => s.name));
  const incoming = new Map<string, ManagedMcpServer>();
  const conflicts = new Set<string>();

  for (const [tool, servers] of found) {
    for (const s of servers) {
      if (known.has(s.name)) continue;
      const prev = incoming.get(s.name);
      if (!prev) {
        incoming.set(s.name, toManaged(s, tool));
        continue;
      }
      prev.targets.push(tool);
      if (tool === "codex") prev.codexExtra = codexExtraFrom(s.extra, s.enabled);
      if (!sameDef(toClaudeDef(prev), claudeDefFromRead(s))) conflicts.add(s.name);
    }
  }

  await writeManagedMcp(ctx, [...existing, ...incoming.values()]);
  return { added: [...incoming.keys()].sort(), conflicts: [...conflicts].sort() };
}

export interface RuleImportResult {
  /** Where the imported text came from. */
  from: ToolId | null;
  /** Claude Code and Codex had different global rules; Claude's was kept. */
  differs: boolean;
}

/** Starts managing the top-level rule with the current CLAUDE.md (or AGENTS.md) of the scope. */
export async function importRule(ctx: PathContext): Promise<RuleImportResult> {
  if (await readManagedRule(ctx)) return { from: null, differs: false };
  const r = new Reader();
  const scope = ctx.project ? "project" : "global";
  const claude = await r.text(claudePaths(ctx)[scope].rulesFile);
  const codex = await r.text(codexPaths(ctx)[scope].rulesFile);
  const body = claude ?? codex ?? "";
  await saveManagedRule(ctx, { body, targets: [...WRITABLE_AGENT_TOOLS] });
  return { from: claude !== null ? "claude" : codex !== null ? "codex" : null, differs: claude !== null && codex !== null && claude !== codex };
}

// ---------------------------------------------------------------------------
// agents and skills

export type ImportSkipReason = "invalid-name" | "no-description" | "codex-ui-file" | "too-large" | "symlink" | "legacy-location" | "binary-file";

export interface ItemImportResult {
  added: string[];
  /** Same name with different content in Claude Code and Codex: Claude's was kept. */
  conflicts: string[];
  /** Items left alone, with the reason. */
  skipped: { name: string; reason: ImportSkipReason }[];
}

const scopeOf = (ctx: PathContext) => (ctx.project ? "project" : "global");

/** Same-named items from both tools, Claude first. Invalid names are reported, not imported. */
function groupByName<T extends { name: string }>(
  found: [ToolId, T[]][],
  known: Set<string>,
  skipped: ItemImportResult["skipped"],
): Map<string, [ToolId, T][]> {
  const groups = new Map<string, [ToolId, T][]>();
  const knownLower = new Set([...known].map((n) => n.toLowerCase()));
  for (const [tool, items] of found) {
    for (const item of items) {
      if (knownLower.has(item.name.toLowerCase())) continue;
      if (!MANAGED_NAME.test(item.name)) {
        if (!skipped.some((s) => s.name === item.name)) skipped.push({ name: item.name, reason: "invalid-name" });
        continue;
      }
      const key = item.name.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), [tool, item]]);
    }
  }
  return groups;
}

const finish = (r: ItemImportResult): ItemImportResult => ({
  added: r.added.sort(),
  conflicts: r.conflicts.sort(),
  skipped: r.skipped.sort((a, b) => a.name.localeCompare(b.name)),
});

/**
 * Starts managing the agents that already exist in the scope (Claude Code
 * `agents/*.md`, Codex `agents/*.toml`). Tool-specific fields are kept as extras.
 */
export async function importAgents(ctx: PathContext): Promise<ItemImportResult> {
  const scope = scopeOf(ctx);
  const inScope = (list: Agent[]) => list.filter((a) => a.source.scope === scope);
  const found: [ToolId, Agent[]][] = [
    ["claude", inScope((await readClaude(ctx)).agents)],
    ["codex", inScope((await readCodex(ctx)).agents)],
  ];
  const result: ItemImportResult = { added: [], conflicts: [], skipped: [] };
  const groups = groupByName(found, new Set((await listAgents(ctx)).map((a) => a.name)), result.skipped);

  for (const entries of groups.values()) {
    const claude = entries.find(([t]) => t === "claude")?.[1];
    const codex = entries.find(([t]) => t === "codex")?.[1];
    const main = (claude ?? codex)!;
    const description = (claude?.description || codex?.description || "").trim();
    if (!description) {
      result.skipped.push({ name: main.name, reason: "no-description" });
      continue;
    }
    const codexExtra = codex ? { ...(codex.model ? { model: codex.model } : {}), ...codex.extra } : undefined;
    const agent: ManagedAgent = {
      name: main.name,
      description,
      body: main.body,
      model: claude?.model,
      tools: claude?.tools,
      targets: entries.map(([t]) => t),
      claudeExtra: claude?.extra,
      codexExtra,
    };
    await writeAgent(ctx, agent);
    result.added.push(agent.name);
    if (claude && codex && (claude.body.trim() !== codex.body.trim() || (claude.description ?? "") !== (codex.description ?? ""))) {
      result.conflicts.push(agent.name);
    }
  }
  return finish(result);
}

/** rulesync keys that live at the top level of a skill's frontmatter. Others are Claude-only. */
const SKILL_TOP_LEVEL = new Set(["disable-model-invocation", "user-invocable", "license", "compatibility", "metadata"]);
const MAX_IMPORT_FILES = 200;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Bundled files of a skill folder, or a skip reason. */
async function skillFiles(dir: string): Promise<string[] | ImportSkipReason> {
  const files: string[] = [];
  let bytes = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.name === ".DS_Store") continue;
    if (e.isSymbolicLink()) return "symlink";
    if (!e.isFile()) continue;
    const rel = join(e.parentPath, e.name).slice(dir.length + 1).replaceAll("\\", "/");
    if (rel === "SKILL.md") continue;
    // The apply pipeline handles text only; binary files would be corrupted.
    const data = await readFile(join(dir, rel));
    if (data.includes(0) || Buffer.compare(Buffer.from(data.toString("utf8"), "utf8"), data) !== 0) return "binary-file";
    bytes += data.length;
    files.push(rel);
    if (files.length > MAX_IMPORT_FILES || bytes > MAX_IMPORT_BYTES) return "too-large";
  }
  return files.sort();
}

/**
 * Starts managing the skills that already exist in the scope (Claude Code
 * `skills/<name>/`, Codex `.agents/skills/<name>/`), bundled files included.
 * Claude's claude.ai-synced skills are never imported.
 */
export async function importSkills(ctx: PathContext): Promise<ItemImportResult> {
  const scope = scopeOf(ctx);
  const inScope = (list: Skill[]) => list.filter((s) => s.source.scope === scope && s.extra.managedBy !== "claude.ai");
  const found: [ToolId, Skill[]][] = [
    ["claude", inScope((await readClaude(ctx)).skills)],
    ["codex", inScope((await readCodex(ctx)).skills)],
  ];
  const result: ItemImportResult = { added: [], conflicts: [], skipped: [] };
  // Codex still reads ~/.codex/skills, but Agent Forge writes ~/.agents/skills: importing would duplicate.
  const legacy = codexPaths(ctx).global.legacySkillsDir;
  found[1][1] = found[1][1].filter((s) => {
    if (!s.source.path.startsWith(legacy)) return true;
    result.skipped.push({ name: s.name, reason: "legacy-location" });
    return false;
  });
  const groups = groupByName(found, new Set((await listSkills(ctx)).map((s) => s.name)), result.skipped);

  for (const entries of groups.values()) {
    const claude = entries.find(([t]) => t === "claude")?.[1];
    const codex = entries.find(([t]) => t === "codex")?.[1];
    const main = (claude ?? codex)!;
    const skip = (reason: ImportSkipReason) => result.skipped.push({ name: main.name, reason });
    if (RESERVED_SKILL_NAMES.includes(main.name.toLowerCase())) {
      skip("invalid-name");
      continue;
    }
    const description = (claude?.description || codex?.description || "").trim();
    if (!description) {
      skip("no-description");
      continue;
    }
    // Codex UI metadata (agents/openai.yaml) is regenerated by rulesync; importing it would lose it.
    if (codex?.files.some((f) => f === "agents/openai.yaml")) {
      skip("codex-ui-file");
      continue;
    }
    const dir = dirname(main.source.path);
    const files = await skillFiles(dir);
    if (typeof files === "string") {
      skip(files);
      continue;
    }

    const extra: Record<string, unknown> = {};
    const claudeSection: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(main.extra)) {
      if (claude && !SKILL_TOP_LEVEL.has(k)) claudeSection[k] = v;
      else extra[k] = v;
    }
    if (Object.keys(claudeSection).length) extra.claudecode = claudeSection;

    const skill: ManagedSkill = { name: main.name, description, body: main.body, targets: entries.map(([t]) => t), extra };
    await writeSkill(ctx, skill);
    const target = join(forgePaths(ctx).skills, skill.name);
    for (const rel of files) {
      await mkdir(dirname(join(target, rel)), { recursive: true });
      await copyFile(join(dir, rel), join(target, rel));
    }
    result.added.push(skill.name);
    if (claude && codex && (claude.body.trim() !== codex.body.trim() || (claude.description ?? "") !== (codex.description ?? ""))) {
      result.conflicts.push(skill.name);
    }
  }
  return finish(result);
}
