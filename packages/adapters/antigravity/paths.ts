// Google Antigravity CLI (agy) config locations. Single source of truth for Antigravity CLI paths.
// Checked against the official Antigravity docs (Nov 2026: rules, skills, subagents,
// MCP, hooks, settings, Gemini CLI migration), not on a real install; tests use fake files.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.gemini — shared with the Antigravity IDE. */
export function geminiHome(ctx: PathContext): string {
  return join(ctx.home, ".gemini");
}

export function antigravityPaths(ctx: PathContext) {
  const g = geminiHome(ctx);
  const cfg = join(g, "config");
  const p = ctx.project;
  const ag = join(p, ".agents");
  return {
    global: {
      /** Standalone global rule files, all always active. */
      rulesFiles: [join(g, "GEMINI.md"), join(g, "AGENTS.md"), join(cfg, "GEMINI.md"), join(cfg, "AGENTS.md")],
      rulesDir: join(cfg, "rules"),
      agentsDir: join(cfg, "agents"),
      /** Shared with the Antigravity app. */
      skillsDir: join(cfg, "skills"),
      /** Read by the CLI only. */
      cliSkillsDir: join(g, "antigravity-cli", "skills"),
      /** Gemini CLI's folder, still read by the CLI. */
      geminiSkillsDir: join(g, "skills"),
      mcpConfig: join(cfg, "mcp_config.json"),
      hooks: join(cfg, "hooks.json"),
      settings: join(g, "antigravity-cli", "settings.json"),
    },
    project: {
      agentsFile: join(p, "AGENTS.md"),
      rulesFile: join(p, "GEMINI.md"),
      nestedRulesFiles: [join(ag, "AGENTS.md"), join(ag, "GEMINI.md")],
      rulesDir: join(ag, "rules"),
      agentsDir: join(ag, "agents"),
      skillsDir: join(ag, "skills"),
      mcpConfig: join(ag, "mcp_config.json"),
      hooks: join(ag, "hooks.json"),
    },
  };
}

function candidates(ctx: PathContext): Candidate[] {
  const { global: g, project: p } = antigravityPaths(ctx);
  const mcp: Candidate["extract"] = { type: "mcp-json", keys: ["mcpServers"] };
  const list: Omit<Candidate, "tool">[] = [
    // global
    ...g.rulesFiles.map((path) => ({ kind: "rules", scope: "global", path, type: "file", format: "markdown", note: "shared with Antigravity app" }) as const),
    { kind: "rules", scope: "global", path: g.rulesDir, type: "dir", format: "markdown", count: "md", note: "shared with Antigravity app" },
    { kind: "agents", scope: "global", path: g.agentsDir, type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "global", path: g.skillsDir, type: "dir", format: "markdown", count: "skill", note: "shared with Antigravity app" },
    { kind: "skills", scope: "global", path: g.cliSkillsDir, type: "dir", format: "markdown", count: "skill" },
    { kind: "skills", scope: "global", path: g.geminiSkillsDir, type: "dir", format: "markdown", count: "skill", note: "shared with Gemini CLI" },
    { kind: "mcp", scope: "global", path: g.mcpConfig, type: "file", format: "json", extract: mcp },
    { kind: "hooks", scope: "global", path: g.hooks, type: "file", format: "json", extract: { type: "top-keys" } },
    { kind: "settings", scope: "global", path: g.settings, type: "file", format: "json", extract: { type: "top-keys" } },
    // project
    { kind: "rules", scope: "project", path: p.agentsFile, type: "file", format: "markdown", note: "shared with codex, copilot" },
    { kind: "rules", scope: "project", path: p.rulesFile, type: "file", format: "markdown" },
    ...p.nestedRulesFiles.map((path) => ({ kind: "rules", scope: "project", path, type: "file", format: "markdown" }) as const),
    { kind: "rules", scope: "project", path: p.rulesDir, type: "dir", format: "markdown", count: "md" },
    { kind: "agents", scope: "project", path: p.agentsDir, type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "project", path: p.skillsDir, type: "dir", format: "markdown", count: "skill", note: "shared .agents tree" },
    { kind: "mcp", scope: "project", path: p.mcpConfig, type: "file", format: "json", extract: mcp },
    { kind: "hooks", scope: "project", path: p.hooks, type: "file", format: "json", extract: { type: "top-keys" } },
  ];
  return list.map((c) => ({ tool: "antigravity", ...c }));
}

export const antigravity: ToolDefinition = {
  id: "antigravity",
  label: "Antigravity CLI",
  binaries: ["agy", "antigravity"],
  // The CLI keeps logins in the OS keyring; these are Gemini CLI / MCP OAuth token files.
  sensitive: ["oauth_creds.json", "google_accounts.json", "mcp_oauth_tokens.json"],
  candidates,
};
