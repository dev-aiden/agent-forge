// Reads Google Antigravity CLI rules, agents, skills and MCP servers into the common model. Read-only.
// Paths are documented but unverified on a real install, so every item is marked unverified.
import type { McpServer, Rule, Source, ToolConfig } from "@agent-forge/model";
import type { PathContext } from "../types";
import { byName, mcpFromJson, readMarkdownAgents, readRootRule, readRulesDir, readSkillsDir, Reader, source } from "../shared/read-utils";
import { antigravityPaths } from "./paths";

const md = { tool: "antigravity", format: "markdown", verified: false } as const;

function serversFrom(data: Record<string, unknown> | undefined, src: Source): McpServer[] {
  const record = data?.mcpServers;
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record)
    .map(([name, entry]) => mcpFromJson(name, entry, src))
    .filter((s): s is McpServer => s !== null);
}

export async function readAntigravity(ctx: PathContext): Promise<ToolConfig> {
  const r = new Reader();
  const { global: g, project: p } = antigravityPaths(ctx);
  const hasProject = ctx.project !== "";

  const rules = (
    await Promise.all([
      readRootRule(r, g.rulesFile, { ...md, scope: "global" }),
      hasProject ? readRootRule(r, p.rulesFile, { ...md, scope: "project" }) : null,
      hasProject ? readRootRule(r, p.agentsFile, { ...md, scope: "project" }) : null,
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
    ...(hasProject ? await readSkillsDir(r, p.skillsDir, { ...md, scope: "project" }) : []),
  ];

  const mcpServers = [
    ...serversFrom((await r.json(g.mcpConfig)) as Record<string, unknown> | undefined, source("antigravity", "global", g.mcpConfig, "json", false)),
    ...(hasProject
      ? serversFrom((await r.json(p.mcpConfig)) as Record<string, unknown> | undefined, source("antigravity", "project", p.mcpConfig, "json", false))
      : []),
  ];

  return { tool: "antigravity", rules, agents: agents.sort(byName), skills: skills.sort(byName), mcpServers: mcpServers.sort(byName), issues: r.issues };
}
