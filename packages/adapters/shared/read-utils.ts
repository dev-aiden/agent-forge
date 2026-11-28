// Read-only helpers shared by tool adapters. Nothing here writes to disk.
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import type {
  Agent,
  Command,
  McpServer,
  McpTransport,
  ReadIssue,
  Rule,
  Scope,
  Skill,
  Source,
  SourceFormat,
  ToolId,
} from "@kitroom/model";
import { antigravity } from "../antigravity/paths";
import { claude } from "../claude/paths";
import { codex } from "../codex/paths";
import { copilot } from "../copilot/paths";

/** Credential file names of every tool. Never opened by any adapter. */
export const SENSITIVE_FILES: ReadonlySet<string> = new Set(
  [claude, codex, copilot, antigravity].flatMap((t) => t.sensitive),
);

export const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_SKILL_FILES = 200;

export function isSensitive(path: string): boolean {
  return SENSITIVE_FILES.has(basename(path));
}

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException)?.code;
}

/**
 * Reads files while collecting problems as issues instead of throwing, so one
 * broken file never hides the rest of a tool's config.
 */
export class Reader {
  readonly issues: ReadIssue[] = [];

  issue(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  /** File text, or null when missing / unreadable (unreadable is recorded as an issue). */
  async text(path: string): Promise<string | null> {
    if (isSensitive(path)) throw new Error(`refusing to read credential file: ${path}`);
    try {
      const st = await stat(path);
      if (!st.isFile()) return null;
      if (st.size > MAX_READ_BYTES) {
        this.issue(path, `file too large (${st.size} bytes)`);
        return null;
      }
      return await readFile(path, "utf8");
    } catch (e) {
      if (errCode(e) === "ENOENT" || errCode(e) === "ENOTDIR") return null;
      this.issue(path, `cannot read (${errCode(e) ?? "unknown error"})`);
      return null;
    }
  }

  /** Parsed JSON, or undefined when missing / invalid. Parser messages are not kept (they may quote content). */
  async json(path: string): Promise<unknown> {
    const text = await this.text(path);
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      this.issue(path, "invalid JSON");
      return undefined;
    }
  }

  async toml(path: string): Promise<Record<string, unknown> | undefined> {
    const text = await this.text(path);
    if (text === null) return undefined;
    try {
      return parseToml(text) as Record<string, unknown>;
    } catch {
      this.issue(path, "invalid TOML");
      return undefined;
    }
  }

  /** Directory entries, or [] when missing. Symlinks are resolved to their target type. */
  async entries(dir: string): Promise<{ name: string; path: string; isDir: boolean; isFile: boolean }[]> {
    let list: Dirent[];
    try {
      list = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (errCode(e) !== "ENOENT" && errCode(e) !== "ENOTDIR") this.issue(dir, `cannot list (${errCode(e)})`);
      return [];
    }
    const out = [];
    for (const d of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, d.name);
      let isDir = d.isDirectory();
      let isFile = d.isFile();
      if (d.isSymbolicLink()) {
        const st = await stat(path).catch(() => null);
        isDir = st?.isDirectory() ?? false;
        isFile = st?.isFile() ?? false;
      }
      out.push({ name: d.name, path, isDir, isFile });
    }
    return out;
  }

  /** Files under dir (recursive) whose name ends with suffix. */
  async filesWithSuffix(dir: string, suffix: string, depth = 0): Promise<string[]> {
    const out: string[] = [];
    for (const e of await this.entries(dir)) {
      if (e.isDir && depth < MAX_DEPTH && !e.name.startsWith(".")) out.push(...(await this.filesWithSuffix(e.path, suffix, depth + 1)));
      else if (e.isFile && e.name.endsWith(suffix) && !isSensitive(e.path)) out.push(e.path);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// value helpers

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Accepts `["a", "b"]` or `"a, b"`. */
export function stringList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const list = v.filter((x): x is string => typeof x === "string");
    return list.length ? list : undefined;
  }
  if (typeof v === "string") {
    const list = v.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  return undefined;
}

export function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const entries = Object.entries(v).map(([k, val]) => [k, String(val)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

/** Relative path with forward slashes on every OS. */
export function relPosix(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export function source(tool: ToolId, scope: Scope, path: string, format: SourceFormat, verified = true): Source {
  return { tool, scope, path, format, verified };
}

export function itemId(src: Source, name?: string): string {
  return `${src.tool}:${src.path}${name ? `#${name}` : ""}`;
}

// ---------------------------------------------------------------------------
// frontmatter

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(reader: Reader, path: string, text: string): Frontmatter {
  const m = text.match(FRONTMATTER);
  if (!m) return { data: {}, body: text };
  const body = text.slice(m[0].length);
  try {
    const data = parseYaml(m[1]);
    if (data && typeof data === "object" && !Array.isArray(data)) return { data: data as Record<string, unknown>, body };
    return { data: {}, body };
  } catch {
    reader.issue(path, "invalid frontmatter");
    return { data: {}, body };
  }
}

// ---------------------------------------------------------------------------
// item readers

type SourceBase = Omit<Source, "path">;

/** A single top-level instruction file such as CLAUDE.md or AGENTS.md. */
export async function readRootRule(reader: Reader, path: string, base: SourceBase): Promise<Rule | null> {
  const text = await reader.text(path);
  if (text === null) return null;
  const src = { ...base, path };
  return { kind: "rule", id: itemId(src), name: basename(path), body: text, root: true, source: src };
}

/** *.md rule files under a directory, with optional frontmatter (description, globs / paths). */
export async function readRulesDir(reader: Reader, dir: string, base: SourceBase): Promise<Rule[]> {
  const rules: Rule[] = [];
  for (const path of await reader.filesWithSuffix(dir, ".md")) {
    const text = await reader.text(path);
    if (text === null) continue;
    const { data, body } = splitFrontmatter(reader, path, text);
    const src = { ...base, path };
    rules.push({
      kind: "rule",
      id: itemId(src),
      name: relPosix(dir, path).replace(/\.md$/, ""),
      description: str(data.description),
      body,
      root: false,
      globs: stringList(data.globs) ?? stringList(data.paths),
      source: src,
    });
  }
  return rules;
}

/** Markdown agents (`*.md` / `*.agent.md`) with frontmatter: name, description, model, tools. */
export async function readMarkdownAgents(reader: Reader, dir: string, base: SourceBase, suffix = ".md"): Promise<Agent[]> {
  const agents: Agent[] = [];
  for (const path of await reader.filesWithSuffix(dir, suffix)) {
    const text = await reader.text(path);
    if (text === null) continue;
    const { data, body } = splitFrontmatter(reader, path, text);
    const src = { ...base, path };
    agents.push({
      kind: "agent",
      id: itemId(src),
      name: str(data.name) ?? basename(path, suffix),
      description: str(data.description),
      body,
      model: str(data.model),
      tools: stringList(data.tools),
      // An explicit empty `tools` (no tools) differs from a missing one (all tools): keep it as-is.
      extra: omit(data, stringList(data.tools) === undefined && data.tools !== undefined ? ["name", "description", "model"] : ["name", "description", "model", "tools"]),
      source: src,
    });
  }
  return agents;
}

/**
 * Custom commands / prompts: `*.md` files under a directory. Files in sub-folders
 * are named `folder/name`. Frontmatter other than `description` is kept in `extra`.
 */
export async function readCommandsDir(reader: Reader, dir: string, base: SourceBase): Promise<Command[]> {
  const commands: Command[] = [];
  for (const path of await reader.filesWithSuffix(dir, ".md")) {
    const text = await reader.text(path);
    if (text === null) continue;
    const { data, body } = splitFrontmatter(reader, path, text);
    const src = { ...base, path };
    commands.push({
      kind: "command",
      id: itemId(src),
      name: relPosix(dir, path).replace(/\.md$/, ""),
      description: str(data.description),
      body,
      extra: omit(data, ["description"]),
      source: src,
    });
  }
  return commands;
}

async function listSkillFiles(reader: Reader, skillDir: string, dir = skillDir, depth = 0, acc: string[] = []): Promise<string[]> {
  for (const e of await reader.entries(dir)) {
    if (acc.length >= MAX_SKILL_FILES) break;
    if (e.name === ".DS_Store") continue;
    if (e.isDir && depth < MAX_DEPTH) await listSkillFiles(reader, skillDir, e.path, depth + 1, acc);
    else if (e.isFile && !(depth === 0 && e.name === "SKILL.md")) acc.push(relPosix(skillDir, e.path));
  }
  return acc;
}

/**
 * Skills: `<dir>/<name>/SKILL.md`. With `nested`, skill folders are searched
 * at any depth (dot-directories skipped), e.g. Claude's synced skills.
 */
export async function readSkillsDir(
  reader: Reader,
  dir: string,
  base: SourceBase,
  opts: { nested?: boolean; extra?: Record<string, unknown> } = {},
  depth = 0,
): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const e of await reader.entries(dir)) {
    if (!e.isDir || e.name.startsWith(".")) continue;
    const skillMd = join(e.path, "SKILL.md");
    const text = await reader.text(skillMd);
    if (text === null) {
      if (opts.nested && depth < MAX_DEPTH) skills.push(...(await readSkillsDir(reader, e.path, base, opts, depth + 1)));
      continue;
    }
    const { data, body } = splitFrontmatter(reader, skillMd, text);
    const src = { ...base, path: skillMd };
    skills.push({
      kind: "skill",
      id: itemId(src),
      name: str(data.name) ?? e.name,
      description: str(data.description),
      body,
      files: await listSkillFiles(reader, e.path),
      extra: { ...omit(data, ["name", "description"]), ...opts.extra },
      source: src,
    });
  }
  return skills;
}

/**
 * One MCP server entry in the common JSON shape used by Claude Code, Copilot
 * and Antigravity: { type?, command, args, env, url, headers, disabled? }.
 */
export function mcpFromJson(name: string, entry: unknown, src: Source): McpServer | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  const url = str(e.url) ?? str(e.serverUrl) ?? str(e.httpUrl);
  const type = str(e.type);
  const transport: McpTransport =
    type === "sse" ? "sse" : type === "http" || type === "streamable-http" || (!type && url) ? "http" : "stdio";
  return {
    kind: "mcp",
    id: itemId(src, name),
    name,
    transport,
    command: str(e.command),
    args: stringList(Array.isArray(e.args) ? e.args : undefined),
    env: stringRecord(e.env),
    url,
    headers: stringRecord(e.headers),
    enabled: e.disabled !== true && e.enabled !== false,
    extra: omit(e, ["type", "command", "args", "env", "url", "serverUrl", "httpUrl", "headers", "disabled", "enabled"]),
    source: src,
  };
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}
