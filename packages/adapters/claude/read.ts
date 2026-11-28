// Reads Claude Code rules, agents, skills, commands and MCP servers into the common model. Read-only.
import type { McpServer, Rule, Source, ToolConfig } from "@kitroom/model";
import type { PathContext } from "../types";
import {
  byName,
  mcpFromJson,
  readCommandsDir,
  readMarkdownAgents,
  readRootRule,
  readRulesDir,
  readSkillsDir,
  Reader,
  source,
} from "../shared/read-utils";
import { claudePaths } from "./paths";

const md = { tool: "claude", format: "markdown", verified: true } as const;

function serversFrom(record: unknown, src: Source): McpServer[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record)
    .map(([name, entry]) => mcpFromJson(name, entry, src))
    .filter((s): s is McpServer => s !== null);
}

export async function readClaude(ctx: PathContext): Promise<ToolConfig> {
  const r = new Reader();
  const { global: g, project: p } = claudePaths(ctx);

  // Project scope is skipped when no project is selected.
  const hasProject = ctx.project !== "";

  const rules = (
    await Promise.all([
      readRootRule(r, g.rulesFile, { ...md, scope: "global" }),
      hasProject ? readRootRule(r, p.rulesFile, { ...md, scope: "project" }) : null,
      hasProject ? readRootRule(r, p.localRulesFile, { ...md, scope: "local" }) : null,
    ])
  ).filter((x): x is Rule => x !== null);
  rules.push(...(await readRulesDir(r, g.rulesDir, { ...md, scope: "global" })));
  if (hasProject) rules.push(...(await readRulesDir(r, p.rulesDir, { ...md, scope: "project" })));

  const agents = [
    ...(await readMarkdownAgents(r, g.agentsDir, { ...md, scope: "global" })),
    ...(hasProject ? await readMarkdownAgents(r, p.agentsDir, { ...md, scope: "project" }) : []),
  ];

  const skills = [
    ...(await readSkillsDir(r, g.skillsDir, { ...md, scope: "global" })),
    // Synced from claude.ai and managed by Claude itself: shown, never edited.
    ...(await readSkillsDir(r, g.syncedSkillsDir, { ...md, scope: "global" }, { nested: true, extra: { managedBy: "claude.ai" } })),
    ...(hasProject ? await readSkillsDir(r, p.skillsDir, { ...md, scope: "project" }) : []),
  ];

  const commands = [
    // Not named in the official docs (only project .claude/commands is): unverified.
    ...(await readCommandsDir(r, g.commandsDir, { ...md, scope: "global", verified: false })),
    ...(hasProject ? await readCommandsDir(r, p.commandsDir, { ...md, scope: "project" }) : []),
  ];

  const mcpServers: McpServer[] = [];
  // ~/.claude.json also stores account info; only the mcpServers keys are used.
  const userJson = (await r.json(g.userJson)) as Record<string, unknown> | undefined;
  if (userJson) {
    mcpServers.push(...serversFrom(userJson.mcpServers, source("claude", "global", g.userJson, "json")));
    const projects = userJson.projects as Record<string, { mcpServers?: unknown }> | undefined;
    if (hasProject) mcpServers.push(...serversFrom(projects?.[ctx.project]?.mcpServers, source("claude", "local", g.userJson, "json")));
  }
  const mcpJson = hasProject ? ((await r.json(p.mcpJson)) as Record<string, unknown> | undefined) : undefined;
  if (mcpJson) mcpServers.push(...serversFrom(mcpJson.mcpServers, source("claude", "project", p.mcpJson, "json")));

  return {
    tool: "claude",
    rules,
    agents: agents.sort(byName),
    skills: skills.sort(byName),
    commands: commands.sort(byName),
    mcpServers: mcpServers.sort(byName),
    issues: r.issues,
  };
}
