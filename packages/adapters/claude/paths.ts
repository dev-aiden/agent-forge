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

export function claudePaths(ctx: PathContext) {
  const g = claudeConfigDir(ctx);
  const p = ctx.project;
  return {
    global: {
      rulesFile: join(g, "CLAUDE.md"),
      rulesDir: join(g, "rules"),
      agentsDir: join(g, "agents"),
      skillsDir: join(g, "skills"),
      syncedSkillsDir: join(g, "skills", "synced"),
      commandsDir: join(g, "commands"),
      /** User-scope `mcpServers` and per-project (local scope) `projects[path].mcpServers`. */
      userJson: claudeUserJson(ctx),
      settings: join(g, "settings.json"),
      installedPlugins: join(g, "plugins", "installed_plugins.json"),
    },
    project: {
      rulesFile: join(p, "CLAUDE.md"),
      localRulesFile: join(p, "CLAUDE.local.md"),
      rulesDir: join(p, ".claude", "rules"),
      agentsDir: join(p, ".claude", "agents"),
      skillsDir: join(p, ".claude", "skills"),
      commandsDir: join(p, ".claude", "commands"),
      mcpJson: join(p, ".mcp.json"),
      settings: join(p, ".claude", "settings.json"),
      localSettings: join(p, ".claude", "settings.local.json"),
    },
  };
}

function candidates(ctx: PathContext): Candidate[] {
  const { global: g, project: p } = claudePaths(ctx);
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: g.rulesFile, type: "file", format: "markdown" },
    { kind: "rules", scope: "global", path: g.rulesDir, type: "dir", format: "markdown", count: "md" },
    { kind: "agents", scope: "global", path: g.agentsDir, type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "global", path: g.skillsDir, type: "dir", format: "markdown", count: "skill" },
    { kind: "skills", scope: "global", path: g.syncedSkillsDir, type: "dir", format: "markdown", count: "skill-nested", note: "synced from claude.ai (managed by Claude)" },
    { kind: "commands", scope: "global", path: g.commandsDir, type: "dir", format: "markdown", count: "md" },
    {
      kind: "mcp", scope: "global", path: g.userJson, type: "file", format: "json",
      extract: { type: "claude-user-json", project: ctx.project },
      note: "user + local scope; also holds account info (not printed)",
    },
    { kind: "settings", scope: "global", path: g.settings, type: "file", format: "json", extract: { type: "top-keys" }, note: "hooks, permissions" },
    { kind: "plugins", scope: "global", path: g.installedPlugins, type: "file", format: "json", extract: { type: "keys-at", at: "plugins" } },
    // project
    { kind: "rules", scope: "project", path: p.rulesFile, type: "file", format: "markdown" },
    { kind: "rules", scope: "local", path: p.localRulesFile, type: "file", format: "markdown" },
    { kind: "rules", scope: "project", path: p.rulesDir, type: "dir", format: "markdown", count: "md" },
    { kind: "agents", scope: "project", path: p.agentsDir, type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "project", path: p.skillsDir, type: "dir", format: "markdown", count: "skill" },
    { kind: "commands", scope: "project", path: p.commandsDir, type: "dir", format: "markdown", count: "md" },
    { kind: "mcp", scope: "project", path: p.mcpJson, type: "file", format: "json", extract: { type: "mcp-json", keys: ["mcpServers"] } },
    { kind: "settings", scope: "project", path: p.settings, type: "file", format: "json", extract: { type: "top-keys" } },
    { kind: "settings", scope: "local", path: p.localSettings, type: "file", format: "json", extract: { type: "top-keys" } },
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
