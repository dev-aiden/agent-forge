// GitHub Copilot CLI config locations. Single source of truth for Copilot CLI paths.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.copilot, or $COPILOT_HOME when set. */
export function copilotHome(ctx: PathContext): string {
  return ctx.env.COPILOT_HOME ?? join(ctx.home, ".copilot");
}

function candidates(ctx: PathContext): Candidate[] {
  const g = copilotHome(ctx);
  const p = ctx.project;
  const gh = join(p, ".github");
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: join(g, "copilot-instructions.md"), type: "file", format: "markdown" },
    { kind: "agents", scope: "global", path: join(g, "agents"), type: "dir", format: "markdown", count: "agent-md" },
    { kind: "skills", scope: "global", path: join(g, "skills"), type: "dir", format: "markdown", count: "skill" },
    { kind: "mcp", scope: "global", path: join(g, "mcp-config.json"), type: "file", format: "json", extract: { type: "mcp-json", keys: ["mcpServers", "servers"] } },
    { kind: "hooks", scope: "global", path: join(g, "hooks"), type: "dir", format: "json", count: "json" },
    { kind: "settings", scope: "global", path: join(g, "settings.json"), type: "file", format: "json", extract: { type: "top-keys" } },
    // project
    { kind: "rules", scope: "project", path: join(gh, "copilot-instructions.md"), type: "file", format: "markdown" },
    { kind: "rules", scope: "project", path: join(gh, "instructions"), type: "dir", format: "markdown", count: "md", note: "*.instructions.md" },
    { kind: "rules", scope: "project", path: join(p, "AGENTS.md"), type: "file", format: "markdown", note: "shared with codex, antigravity" },
    { kind: "agents", scope: "project", path: join(gh, "agents"), type: "dir", format: "markdown", count: "agent-md" },
    { kind: "skills", scope: "project", path: join(gh, "skills"), type: "dir", format: "markdown", count: "skill" },
    { kind: "mcp", scope: "project", path: join(gh, "mcp.json"), type: "file", format: "json", extract: { type: "mcp-json", keys: ["mcpServers", "servers"] }, note: "unverified path" },
    { kind: "hooks", scope: "project", path: join(gh, "hooks"), type: "dir", format: "json", count: "json" },
    { kind: "settings", scope: "project", path: join(gh, "copilot", "settings.json"), type: "file", format: "json", extract: { type: "top-keys" } },
  ];
  return list.map((c) => ({ tool: "copilot", ...c }));
}

export const copilot: ToolDefinition = {
  id: "copilot",
  label: "Copilot CLI",
  binaries: ["copilot"],
  // config.json stores logged-in users and tokens.
  sensitive: ["config.json"],
  candidates,
};
