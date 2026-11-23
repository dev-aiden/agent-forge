// GitHub Copilot CLI config locations. Single source of truth for Copilot CLI paths.
// Checked against the official GitHub docs (Nov 2026: CLI configuration directory,
// custom instructions support, add skills / MCP servers / custom agents for the CLI),
// not on a real install; tests use fake files.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.copilot, or $COPILOT_HOME when set. */
export function copilotHome(ctx: PathContext): string {
  return ctx.env.COPILOT_HOME ?? join(ctx.home, ".copilot");
}

export function copilotPaths(ctx: PathContext) {
  const g = copilotHome(ctx);
  const p = ctx.project;
  const gh = join(p, ".github");
  return {
    global: {
      rulesFile: join(g, "copilot-instructions.md"),
      instructionsDir: join(g, "instructions"),
      agentsDir: join(g, "agents"),
      skillsDir: join(g, "skills"),
      mcpConfig: join(g, "mcp-config.json"),
      hooksDir: join(g, "hooks"),
      settings: join(g, "settings.json"),
    },
    project: {
      rulesFile: join(gh, "copilot-instructions.md"),
      instructionsDir: join(gh, "instructions"),
      agentsFile: join(p, "AGENTS.md"),
      agentsDir: join(gh, "agents"),
      skillsDir: join(gh, "skills"),
      mcpConfig: join(gh, "mcp.json"),
      /** Also read by Copilot CLI; wins over .github/mcp.json. Owned by Claude Code. */
      sharedMcpConfig: join(p, ".mcp.json"),
      hooksDir: join(gh, "hooks"),
      settings: join(gh, "copilot", "settings.json"),
      settingsLocal: join(gh, "copilot", "settings.local.json"),
    },
  };
}

function candidates(ctx: PathContext): Candidate[] {
  const { global: g, project: p } = copilotPaths(ctx);
  const mcp: Candidate["extract"] = { type: "mcp-json", keys: ["mcpServers", "servers"] };
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: g.rulesFile, type: "file", format: "markdown" },
    { kind: "rules", scope: "global", path: g.instructionsDir, type: "dir", format: "markdown", count: "md", note: "*.instructions.md" },
    { kind: "agents", scope: "global", path: g.agentsDir, type: "dir", format: "markdown", count: "agent-md" },
    { kind: "skills", scope: "global", path: g.skillsDir, type: "dir", format: "markdown", count: "skill" },
    { kind: "mcp", scope: "global", path: g.mcpConfig, type: "file", format: "json", extract: mcp },
    { kind: "hooks", scope: "global", path: g.hooksDir, type: "dir", format: "json", count: "json" },
    { kind: "settings", scope: "global", path: g.settings, type: "file", format: "json", extract: { type: "top-keys" } },
    // project
    { kind: "rules", scope: "project", path: p.rulesFile, type: "file", format: "markdown" },
    { kind: "rules", scope: "project", path: p.instructionsDir, type: "dir", format: "markdown", count: "md", note: "*.instructions.md" },
    { kind: "rules", scope: "project", path: p.agentsFile, type: "file", format: "markdown", note: "shared with codex, antigravity" },
    { kind: "agents", scope: "project", path: p.agentsDir, type: "dir", format: "markdown", count: "agent-md" },
    { kind: "skills", scope: "project", path: p.skillsDir, type: "dir", format: "markdown", count: "skill" },
    { kind: "mcp", scope: "project", path: p.mcpConfig, type: "file", format: "json", extract: mcp },
    { kind: "mcp", scope: "project", path: p.sharedMcpConfig, type: "file", format: "json", extract: mcp, note: "shared with claude" },
    { kind: "hooks", scope: "project", path: p.hooksDir, type: "dir", format: "json", count: "json" },
    { kind: "settings", scope: "project", path: p.settings, type: "file", format: "json", extract: { type: "top-keys" } },
    { kind: "settings", scope: "project", path: p.settingsLocal, type: "file", format: "json", extract: { type: "top-keys" } },
  ];
  return list.map((c) => ({ tool: "copilot", ...c }));
}

export const copilot: ToolDefinition = {
  id: "copilot",
  label: "Copilot CLI",
  binaries: ["copilot"],
  // config.json stores logged-in users and (without a keychain) tokens;
  // providers.json stores model provider API keys in plain text.
  sensitive: ["config.json", "providers.json"],
  candidates,
};
