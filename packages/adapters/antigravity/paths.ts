// Google Antigravity CLI (agy) config locations. Single source of truth for Antigravity CLI paths.
// Antigravity CLI is not installed on the development machine: every path here is
// taken from documentation and verified only with fake files.
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
      rulesFile: join(g, "GEMINI.md"),
      rulesDir: join(cfg, "rules"),
      agentsDir: join(cfg, "agents"),
      skillsDir: join(g, "antigravity-cli", "skills"),
      mcpConfig: join(cfg, "mcp_config.json"),
      hooks: join(cfg, "hooks.json"),
    },
    project: {
      agentsFile: join(p, "AGENTS.md"),
      rulesFile: join(p, "GEMINI.md"),
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
    { kind: "rules", scope: "global", path: g.rulesFile, type: "file", format: "markdown", note: "shared with Antigravity IDE" },
    { kind: "rules", scope: "global", path: g.rulesDir, type: "dir", format: "markdown", count: "md", note: "shared with Antigravity IDE" },
    { kind: "agents", scope: "global", path: g.agentsDir, type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "global", path: g.skillsDir, type: "dir", format: "markdown", count: "skill", note: "also holds commands" },
    { kind: "mcp", scope: "global", path: g.mcpConfig, type: "file", format: "json", extract: mcp },
    { kind: "hooks", scope: "global", path: g.hooks, type: "file", format: "json", extract: { type: "top-keys" } },
    // project
    { kind: "rules", scope: "project", path: p.agentsFile, type: "file", format: "markdown", note: "shared with codex, copilot" },
    { kind: "rules", scope: "project", path: p.rulesFile, type: "file", format: "markdown" },
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
  sensitive: ["oauth_creds.json", "google_accounts.json"],
  candidates,
};
