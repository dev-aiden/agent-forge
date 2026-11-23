// Claude Code MCP servers are changed only through the official CLI
// (`claude mcp add-json -s user` / `claude mcp remove -s user`), never by writing
// ~/.claude.json directly: that file also holds account data, and Claude Code
// rewrites it while running.
import type { ManagedMcpServer, McpServer } from "@kitroom/model";
import { readClaude } from "../claude/read";
import type { PathContext } from "../types";

/** Server definition in Claude Code's JSON shape. */
export interface ClaudeMcpDef {
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface CommandChange {
  tool: "claude";
  name: string;
  action: "add" | "replace" | "remove" | "unchanged";
  before: ClaudeMcpDef | null;
  after: ClaudeMcpDef | null;
  /** The server exists in Claude Code but not in Kitroom's list (will be removed). */
  unmanaged: boolean;
}

/** Runs `claude <args>` with optional stdin; rejects on a non-zero exit. */
export type ClaudeCliRunner = (args: string[], stdin?: string) => Promise<void>;

function compact(def: ClaudeMcpDef): ClaudeMcpDef {
  const out: ClaudeMcpDef = { type: def.type };
  if (def.command) out.command = def.command;
  if (def.args?.length) out.args = def.args;
  if (def.env && Object.keys(def.env).length) out.env = def.env;
  if (def.url) out.url = def.url;
  if (def.headers && Object.keys(def.headers).length) out.headers = def.headers;
  return out;
}

export function toClaudeDef(s: ManagedMcpServer): ClaudeMcpDef {
  return compact({ type: s.transport, command: s.command, args: s.args, env: s.env, url: s.url, headers: s.headers });
}

export function claudeDefFromRead(s: McpServer): ClaudeMcpDef {
  return compact({ type: s.transport, command: s.command, args: s.args, env: s.env, url: s.url, headers: s.headers });
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
      : val,
  );
}

export function sameDef(a: ClaudeMcpDef | null, b: ClaudeMcpDef | null): boolean {
  return canonical(a) === canonical(b);
}

/** User-scope servers currently configured in Claude Code. */
export async function currentClaudeServers(ctx: PathContext): Promise<Map<string, ClaudeMcpDef>> {
  const config = await readClaude({ ...ctx, project: "" });
  const map = new Map<string, ClaudeMcpDef>();
  for (const s of config.mcpServers) if (s.source.scope === "global") map.set(s.name, claudeDefFromRead(s));
  return map;
}

/** Commands that make Claude Code's user-scope servers match the managed list. */
export async function planClaudeMcp(ctx: PathContext, managed: ManagedMcpServer[]): Promise<CommandChange[]> {
  const current = await currentClaudeServers(ctx);
  const managedNames = new Set(managed.map((s) => s.name));
  const desired = new Map(managed.filter((s) => s.targets.includes("claude")).map((s) => [s.name, toClaudeDef(s)]));
  const changes: CommandChange[] = [];
  for (const [name, after] of desired) {
    const before = current.get(name) ?? null;
    const action = before === null ? "add" : sameDef(before, after) ? "unchanged" : "replace";
    changes.push({ tool: "claude", name, action, before, after, unmanaged: false });
  }
  for (const [name, before] of current) {
    if (!desired.has(name)) changes.push({ tool: "claude", name, action: "remove", before, after: null, unmanaged: !managedNames.has(name) });
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Moves one server from `from` to `to` using the CLI (null = absent). */
export async function runClaudeChange(
  run: ClaudeCliRunner,
  name: string,
  from: ClaudeMcpDef | null,
  to: ClaudeMcpDef | null,
): Promise<void> {
  if (from !== null) await run(["mcp", "remove", name, "-s", "user"]);
  // JSON goes through stdin so secrets never appear in the process list.
  if (to !== null) await run(["mcp", "add-json", name, "-", "-s", "user"], JSON.stringify(to));
}
