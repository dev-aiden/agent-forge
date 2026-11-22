// Brings the current global rule / MCP servers of each tool into Agent Forge, so
// that applying (which replaces the whole MCP list and the root rule file) keeps
// what the user already has.
import { WRITABLE_AGENT_TOOLS, type ManagedMcpServer, type McpServer, type ToolId } from "@agent-forge/model";
import { claudePaths } from "../claude/paths";
import { readClaude } from "../claude/read";
import { codexPaths } from "../codex/paths";
import { readCodex } from "../codex/read";
import { Reader } from "../shared/read-utils";
import type { PathContext } from "../types";
import { claudeDefFromRead, sameDef, toClaudeDef } from "./claude-mcp";
import { readManagedMcp, readManagedRule, saveManagedRule, writeManagedMcp } from "./config-store";

export interface McpImportResult {
  added: string[];
  /** Same name configured differently in Claude Code and Codex: Claude's version was kept. */
  conflicts: string[];
}

function toManaged(s: McpServer, tool: ToolId): ManagedMcpServer {
  return {
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

/** Adds servers found in Claude Code (user scope) and Codex (global) that Agent Forge does not list yet. */
export async function importMcp(ctx: PathContext): Promise<McpImportResult> {
  const global = { ...ctx, project: "" };
  const found: [ToolId, McpServer[]][] = [
    ["claude", (await readClaude(global)).mcpServers.filter((s) => s.source.scope === "global")],
    ["codex", (await readCodex(global)).mcpServers.filter((s) => s.source.scope === "global")],
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

/** Starts managing the global rule with the current CLAUDE.md (or AGENTS.md). */
export async function importRule(ctx: PathContext): Promise<RuleImportResult> {
  if (await readManagedRule(ctx)) return { from: null, differs: false };
  const r = new Reader();
  const claude = await r.text(claudePaths(ctx).global.rulesFile);
  const codex = await r.text(codexPaths(ctx).global.rulesFile);
  const body = claude ?? codex ?? "";
  await saveManagedRule(ctx, { body, targets: [...WRITABLE_AGENT_TOOLS] });
  return { from: claude !== null ? "claude" : codex !== null ? "codex" : null, differs: claude !== null && codex !== null && claude !== codex };
}
