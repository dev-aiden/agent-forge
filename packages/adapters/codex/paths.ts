// Codex CLI config locations. Single source of truth for Codex CLI paths.
import { join } from "node:path";
import type { Candidate, PathContext, ToolDefinition } from "../types";

/** ~/.codex, or $CODEX_HOME when set. */
export function codexHome(ctx: PathContext): string {
  return ctx.env.CODEX_HOME ?? join(ctx.home, ".codex");
}

export function codexPaths(ctx: PathContext) {
  const g = codexHome(ctx);
  const p = ctx.project;
  return {
    global: {
      rulesFile: join(g, "AGENTS.md"),
      overrideRulesFile: join(g, "AGENTS.override.md"),
      /** Unverified: not documented by rulesync or Codex docs we checked. */
      agentsDir: join(g, "agents"),
      skillsDir: join(ctx.home, ".agents", "skills"),
      legacySkillsDir: join(g, "skills"),
      promptsDir: join(g, "prompts"),
      config: join(g, "config.toml"),
      hooks: join(g, "hooks.json"),
      execRulesDir: join(g, "rules"),
    },
    project: {
      rulesFile: join(p, "AGENTS.md"),
      overrideRulesFile: join(p, "AGENTS.override.md"),
      /** Unverified, see global.agentsDir. */
      agentsDir: join(p, ".codex", "agents"),
      skillsDir: join(p, ".agents", "skills"),
      config: join(p, ".codex", "config.toml"),
      hooks: join(p, ".codex", "hooks.json"),
    },
  };
}

function candidates(ctx: PathContext): Candidate[] {
  const { global: g, project: p } = codexPaths(ctx);
  const list: Omit<Candidate, "tool">[] = [
    // global
    { kind: "rules", scope: "global", path: g.rulesFile, type: "file", format: "markdown" },
    { kind: "rules", scope: "global", path: g.overrideRulesFile, type: "file", format: "markdown" },
    { kind: "agents", scope: "global", path: g.agentsDir, type: "dir", format: "toml", count: "toml", note: "unverified path" },
    { kind: "skills", scope: "global", path: g.skillsDir, type: "dir", format: "markdown", count: "skill", note: "shared .agents tree" },
    { kind: "skills", scope: "global", path: g.legacySkillsDir, type: "dir", format: "markdown", count: "skill", note: "legacy location" },
    { kind: "commands", scope: "global", path: g.promptsDir, type: "dir", format: "markdown", count: "md", note: "custom prompts (deprecated upstream)" },
    { kind: "mcp", scope: "global", path: g.config, type: "file", format: "toml", extract: { type: "mcp-toml" } },
    { kind: "hooks", scope: "global", path: g.hooks, type: "file", format: "json", extract: { type: "top-keys" } },
    { kind: "settings", scope: "global", path: g.execRulesDir, type: "dir", format: "mixed", count: "entries", note: "exec policy rules" },
    // project
    { kind: "rules", scope: "project", path: p.rulesFile, type: "file", format: "markdown", note: "shared with copilot, antigravity" },
    { kind: "rules", scope: "project", path: p.overrideRulesFile, type: "file", format: "markdown" },
    { kind: "agents", scope: "project", path: p.agentsDir, type: "dir", format: "toml", count: "toml", note: "unverified path" },
    { kind: "skills", scope: "project", path: p.skillsDir, type: "dir", format: "markdown", count: "skill", note: "shared .agents tree" },
    { kind: "mcp", scope: "project", path: p.config, type: "file", format: "toml", extract: { type: "mcp-toml" } },
    { kind: "hooks", scope: "project", path: p.hooks, type: "file", format: "json", extract: { type: "top-keys" } },
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
