/**
 * Read-only scanner: finds rules / agents / skills / MCP config files used by
 * Claude Code, Codex CLI, Copilot CLI and Antigravity CLI on this machine and
 * prints their paths and formats as a table.
 *
 * Safety guarantees:
 * - Only stat / readdir / readFile are used. Nothing is written, moved or deleted.
 * - File contents are never printed. Structured files are parsed only to list
 *   key names (MCP server names, top-level setting keys), never values.
 * - Credential files declared in each adapter's `sensitive` list are never opened.
 * - CLI binaries are located on PATH but never executed.
 *
 * CLI: packages/adapters/scripts/scan.ts
 */
import { readdir, readFile, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, delimiter, join, sep } from "node:path";
import { antigravity } from "./antigravity/paths";
import { claude } from "./claude/paths";
import { codex } from "./codex/paths";
import { copilot } from "./copilot/paths";
import type { Candidate, CountMode, Extract, PathContext, ToolDefinition, ToolId } from "./types";

export const TOOLS: ToolDefinition[] = [claude, codex, copilot, antigravity];

/** Files larger than this are not parsed. */
const MAX_PARSE_BYTES = 5 * 1024 * 1024;
/** Directory recursion depth limit when counting items. */
const MAX_DEPTH = 4;

export type Status = "found" | "missing" | "wrong-type" | "excluded" | "error";

export interface ScanEntry extends Candidate {
  status: Status;
  /** Number of items (dir entries matched by count mode, or extracted keys). */
  items?: number;
  /** Extracted key names (MCP server names, setting keys...). Never values. */
  names?: string[];
  size?: number;
  modified?: string;
  error?: string;
}

export interface ToolSummary {
  id: ToolId;
  label: string;
  binary: string | null;
  found: number;
  detected: boolean;
}

export interface ScanResult {
  home: string;
  project: string;
  tools: ToolSummary[];
  entries: ScanEntry[];
}

// ---------------------------------------------------------------------------
// fs helpers (read-only)

async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await stat(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR") return null;
    throw e;
  }
}

async function countDir(dir: string, mode: CountMode, depth = 0): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (mode === "entries") return entries.filter((e) => e.name !== ".DS_Store").length;

  let n = 0;
  for (const e of entries) {
    const full = join(dir, e.name);
    // Resolve symlinks so linked skills/agents are counted.
    const st = e.isSymbolicLink() ? await statOrNull(full) : null;
    const isDir = e.isDirectory() || (st?.isDirectory() ?? false);
    const isFile = e.isFile() || (st?.isFile() ?? false);

    if (mode === "skill" || mode === "skill-nested") {
      if (!isDir) continue;
      if ((await statOrNull(join(full, "SKILL.md")))?.isFile()) n++;
      else if (mode === "skill-nested" && !e.name.startsWith(".") && depth < MAX_DEPTH) n += await countDir(full, mode, depth + 1);
      continue;
    }
    if (isDir) {
      if (depth < MAX_DEPTH) n += await countDir(full, mode, depth + 1);
      continue;
    }
    if (!isFile) continue;
    if (mode === "md" && e.name.endsWith(".md")) n++;
    else if (mode === "agent-md" && e.name.endsWith(".agent.md")) n++;
    else if (mode === "toml" && e.name.endsWith(".toml")) n++;
    else if (mode === "json" && e.name.endsWith(".json")) n++;
  }
  return n;
}

function objectKeys(v: unknown): string[] {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : [];
}

/** Returns key names only. Values are discarded immediately. */
async function extractNames(file: string, spec: Extract): Promise<string[]> {
  const text = await readFile(file, "utf8");

  if (spec.type === "mcp-toml") {
    const names: string[] = [];
    // Matches [mcp_servers.name], [mcp_servers."name"]; skips nested tables like [mcp_servers.name.env].
    const re = /^\s*\[\s*mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*\]/gm;
    for (const m of text.matchAll(re)) names.push(m[1] ?? m[2] ?? m[3]);
    return names;
  }

  const json: unknown = JSON.parse(text);
  const root = json as Record<string, unknown>;

  switch (spec.type) {
    case "top-keys":
      return objectKeys(root);
    case "keys-at":
      return objectKeys(root?.[spec.at]);
    case "mcp-json": {
      for (const k of spec.keys) {
        if (root && k in root) return objectKeys(root[k]);
      }
      return [];
    }
    case "claude-user-json": {
      // Only mcpServers is touched. Other keys (oauthAccount, userID...) are ignored.
      const names = objectKeys(root?.mcpServers).map((n) => `user:${n}`);
      const projects = root?.projects as Record<string, { mcpServers?: unknown }> | undefined;
      const local = projects?.[spec.project]?.mcpServers;
      names.push(...objectKeys(local).map((n) => `local:${n}`));
      return names;
    }
  }
}

async function findBinary(names: string[], env: PathContext["env"]): Promise<string | null> {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const name of names) {
    for (const d of dirs) {
      for (const ext of exts) {
        const p = join(d, name + ext);
        if ((await statOrNull(p))?.isFile()) return p;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// scan

async function scanCandidate(c: Candidate, sensitive: Set<string>): Promise<ScanEntry> {
  if (sensitive.has(basename(c.path))) return { ...c, status: "excluded" };
  try {
    const st = await statOrNull(c.path);
    if (!st) return { ...c, status: "missing" };

    const entry: ScanEntry = {
      ...c,
      status: "found",
      modified: st.mtime.toISOString().slice(0, 10),
    };

    if (c.type === "dir") {
      if (!st.isDirectory()) return { ...entry, status: "wrong-type" };
      entry.items = await countDir(c.path, c.count ?? "entries");
      return entry;
    }

    if (!st.isFile()) return { ...entry, status: "wrong-type" };
    entry.size = st.size;
    if (c.extract) {
      if (st.size > MAX_PARSE_BYTES) return { ...entry, error: "too large to parse" };
      try {
        entry.names = await extractNames(c.path, c.extract);
        entry.items = entry.names.length;
      } catch {
        // Do not echo the parser message: it may quote file contents.
        entry.error = "parse error";
      }
    }
    return entry;
  } catch (e) {
    return { ...c, status: "error", error: (e as NodeJS.ErrnoException).code ?? "unknown error" };
  }
}

export async function scan(ctx: PathContext, tools: ToolDefinition[] = TOOLS): Promise<ScanResult> {
  const sensitive = new Set(tools.flatMap((t) => t.sensitive));
  const entries: ScanEntry[] = [];
  const summaries: ToolSummary[] = [];

  for (const tool of tools) {
    // Without a project, project/local candidates would resolve relative to the cwd: skip them.
    const candidates = tool.candidates(ctx).filter((c) => ctx.project || c.scope === "global");
    const results = await Promise.all(candidates.map((c) => scanCandidate(c, sensitive)));
    entries.push(...results);
    const binary = await findBinary(tool.binaries, ctx.env);
    const found = results.filter((r) => r.status === "found").length;
    summaries.push({ id: tool.id, label: tool.label, binary, found, detected: binary !== null || found > 0 });
  }

  return { home: ctx.home, project: ctx.project, tools: summaries, entries };
}

// ---------------------------------------------------------------------------
// output

function shortPath(p: string, ctx: { home: string; project: string }): string {
  if (p === ctx.project || p.startsWith(ctx.project + sep)) return "." + p.slice(ctx.project.length);
  if (p === ctx.home || p.startsWith(ctx.home + sep)) return "~" + p.slice(ctx.home.length);
  return p;
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [line(rows[0]), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(line)].join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const STATUS_MARK: Record<Status, string> = {
  found: "yes",
  missing: "-",
  "wrong-type": "WRONG TYPE",
  excluded: "excluded",
  error: "ERROR",
};

export function formatText(result: ScanResult, opts: { foundOnly: boolean }): string {
  const out: string[] = [];
  out.push(`home:    ${result.home}`);
  out.push(`project: ${result.project}`);
  out.push("");
  out.push(
    table([
      ["TOOL", "DETECTED", "BINARY", "CONFIG FILES"],
      ...result.tools.map((t) => [t.label, t.detected ? "yes" : "no", t.binary ? shortPath(t.binary, result) : "-", String(t.found)]),
    ]),
  );

  const rows = result.entries.filter((e) => !opts.foundOnly || e.status === "found");
  out.push("");
  out.push(
    table([
      ["TOOL", "KIND", "SCOPE", "FOUND", "ITEMS", "FORMAT", "MODIFIED", "PATH", "DETAIL"],
      ...rows.map((e) => {
        const detail = [e.names?.length ? e.names.join(", ") : "", e.error ?? "", e.note ?? ""].filter(Boolean).join(" | ");
        return [
          e.tool,
          e.kind,
          e.scope,
          STATUS_MARK[e.status],
          e.items !== undefined ? String(e.items) : "",
          e.format,
          e.modified ?? "",
          shortPath(e.path, result) + (e.type === "dir" ? "/" : ""),
          truncate(detail, 60),
        ];
      }),
    ]),
  );
  return out.join("\n");
}
