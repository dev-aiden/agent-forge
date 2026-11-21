// Codex CLI config locations. Single source of truth for Codex CLI paths.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.codex, or $CODEX_HOME when set. */
export function codexHome(ctx: PathContext): string {
  return ctx.env.CODEX_HOME ?? join(ctx.home, ".codex");
}

function candidates(ctx: PathContext): Candidate[] {
  const g = codexHome(ctx);
  const p = ctx.project;
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: join(g, "AGENTS.md"), type: "file", format: "markdown" },
    { kind: "rules", scope: "global", path: join(g, "AGENTS.override.md"), type: "file", format: "markdown" },
    { kind: "agents", scope: "global", path: join(g, "agents"), type: "dir", format: "toml", count: "toml", note: "unverified path" },
    { kind: "skills", scope: "global", path: join(ctx.home, ".agents", "skills"), type: "dir", format: "markdown", count: "skill", note: "shared .agents tree" },
    { kind: "skills", scope: "global", path: join(g, "skills"), type: "dir", format: "markdown", count: "skill", note: "legacy location" },
    { kind: "commands", scope: "global", path: join(g, "prompts"), type: "dir", format: "markdown", count: "md", note: "custom prompts (deprecated upstream)" },
    { kind: "mcp", scope: "global", path: join(g, "config.toml"), type: "file", format: "toml", extract: { type: "mcp-toml" } },
    { kind: "hooks", scope: "global", path: join(g, "hooks.json"), type: "file", format: "json", extract: { type: "top-keys" } },
    { kind: "settings", scope: "global", path: join(g, "rules"), type: "dir", format: "mixed", count: "entries", note: "exec policy rules" },
    // project
    { kind: "rules", scope: "project", path: join(p, "AGENTS.md"), type: "file", format: "markdown", note: "shared with copilot, antigravity" },
    { kind: "rules", scope: "project", path: join(p, "AGENTS.override.md"), type: "file", format: "markdown" },
    { kind: "agents", scope: "project", path: join(p, ".codex", "agents"), type: "dir", format: "toml", count: "toml", note: "unverified path" },
    { kind: "skills", scope: "project", path: join(p, ".agents", "skills"), type: "dir", format: "markdown", count: "skill", note: "shared .agents tree" },
    { kind: "mcp", scope: "project", path: join(p, ".codex", "config.toml"), type: "file", format: "toml", extract: { type: "mcp-toml" } },
    { kind: "hooks", scope: "project", path: join(p, ".codex", "hooks.json"), type: "file", format: "json", extract: { type: "top-keys" } },
  ];
  return list.map((c) => ({ tool: "codex", ...c }));
}

export const codex: ToolDefinition = {
  id: "codex",
  label: "Codex CLI",
  binaries: ["codex"],
  sensitive: ["auth.json"],
  candidates,
};
