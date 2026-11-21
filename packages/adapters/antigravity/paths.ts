// Google Antigravity CLI (agy) config locations. Single source of truth for Antigravity CLI paths.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.gemini — shared with the Antigravity IDE. */
export function geminiHome(ctx: PathContext): string {
  return join(ctx.home, ".gemini");
}

function candidates(ctx: PathContext): Candidate[] {
  const g = geminiHome(ctx);
  const cfg = join(g, "config");
  const p = ctx.project;
  const ag = join(p, ".agents");
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: join(g, "GEMINI.md"), type: "file", format: "markdown", note: "shared with Antigravity IDE" },
    { kind: "rules", scope: "global", path: join(cfg, "rules"), type: "dir", format: "markdown", count: "md", note: "shared with Antigravity IDE" },
    { kind: "agents", scope: "global", path: join(cfg, "agents"), type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "global", path: join(g, "antigravity-cli", "skills"), type: "dir", format: "markdown", count: "skill", note: "also holds commands" },
    { kind: "mcp", scope: "global", path: join(cfg, "mcp_config.json"), type: "file", format: "json", extract: { type: "mcp-json", keys: ["mcpServers"] } },
    { kind: "hooks", scope: "global", path: join(cfg, "hooks.json"), type: "file", format: "json", extract: { type: "top-keys" } },
    // project
    { kind: "rules", scope: "project", path: join(p, "AGENTS.md"), type: "file", format: "markdown", note: "shared with codex, copilot" },
    { kind: "rules", scope: "project", path: join(p, "GEMINI.md"), type: "file", format: "markdown" },
    { kind: "rules", scope: "project", path: join(ag, "rules"), type: "dir", format: "markdown", count: "md" },
    { kind: "agents", scope: "project", path: join(ag, "agents"), type: "dir", format: "markdown", count: "md" },
    { kind: "skills", scope: "project", path: join(ag, "skills"), type: "dir", format: "markdown", count: "skill", note: "shared .agents tree" },
    { kind: "mcp", scope: "project", path: join(ag, "mcp_config.json"), type: "file", format: "json", extract: { type: "mcp-json", keys: ["mcpServers"] } },
    { kind: "hooks", scope: "project", path: join(ag, "hooks.json"), type: "file", format: "json", extract: { type: "top-keys" } },
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
