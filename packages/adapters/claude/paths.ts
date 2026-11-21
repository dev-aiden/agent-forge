// Claude Code config locations. Single source of truth for Claude Code paths.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.claude, or $CLAUDE_CONFIG_DIR when set. */
export function claudeConfigDir(ctx: PathContext): string {
  return ctx.env.CLAUDE_CONFIG_DIR ?? join(ctx.home, ".claude");
}

/** ~/.claude.json holds user/local MCP servers (and account info we must never print). */
export function claudeUserJson(ctx: PathContext): string {
  return ctx.env.CLAUDE_CONFIG_DIR
    ? join(ctx.env.CLAUDE_CONFIG_DIR, ".claude.json")
    : join(ctx.home, ".claude.json");
}

function candidates(ctx: PathContext): Candidate[] {
  const g = claudeConfigDir(ctx);
  const p = ctx.project;
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: join(g, "CLAUDE.md"), type: "file", format: "markdown" },
    { kind: "rules", scope: "global", path: join(g, "rules"), type: "dir", format: "markdown", count: "md" },
    { kind: "agents", scope: "global", path: join(g, "agents"), type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "global", path: join(g, "skills"), type: "dir", format: "markdown", count: "skill" },
    { kind: "skills", scope: "global", path: join(g, "skills", "synced"), type: "dir", format: "markdown", count: "skill-nested", note: "synced from claude.ai (managed by Claude)" },
    { kind: "commands", scope: "global", path: join(g, "commands"), type: "dir", format: "markdown", count: "md" },
    {
      kind: "mcp", scope: "global", path: claudeUserJson(ctx), type: "file", format: "json",
      extract: { type: "claude-user-json", project: p },
      note: "user + local scope; also holds account info (not printed)",
    },
    { kind: "settings", scope: "global", path: join(g, "settings.json"), type: "file", format: "json", extract: { type: "top-keys" }, note: "hooks, permissions" },
    { kind: "plugins", scope: "global", path: join(g, "plugins", "installed_plugins.json"), type: "file", format: "json", extract: { type: "keys-at", at: "plugins" } },
    // project
    { kind: "rules", scope: "project", path: join(p, "CLAUDE.md"), type: "file", format: "markdown" },
    { kind: "rules", scope: "project", path: join(p, "CLAUDE.local.md"), type: "file", format: "markdown" },
    { kind: "rules", scope: "project", path: join(p, ".claude", "rules"), type: "dir", format: "markdown", count: "md" },
    { kind: "agents", scope: "project", path: join(p, ".claude", "agents"), type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "project", path: join(p, ".claude", "skills"), type: "dir", format: "markdown", count: "skill" },
    { kind: "commands", scope: "project", path: join(p, ".claude", "commands"), type: "dir", format: "markdown", count: "md" },
    { kind: "mcp", scope: "project", path: join(p, ".mcp.json"), type: "file", format: "json", extract: { type: "mcp-json", keys: ["mcpServers"] } },
    { kind: "settings", scope: "project", path: join(p, ".claude", "settings.json"), type: "file", format: "json", extract: { type: "top-keys" } },
    { kind: "settings", scope: "project", path: join(p, ".claude", "settings.local.json"), type: "file", format: "json", extract: { type: "top-keys" } },
  ];
  return list.map((c) => ({ tool: "claude", ...c }));
}

export const claude: ToolDefinition = {
  id: "claude",
  label: "Claude Code",
  binaries: ["claude"],
  sensitive: [".credentials.json"],
  candidates,
};
