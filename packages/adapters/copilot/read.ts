// Reads GitHub Copilot CLI rules, agents, skills and MCP servers into the common model. Read-only.
// Paths follow the official docs (see paths.ts).
import type { Agent, McpServer, Rule, Source, ToolConfig } from "@kitroom/model";
import type { PathContext } from "../types";
import { byName, mcpFromJson, readMarkdownAgents, readRootRule, readRulesDir, readSkillsDir, Reader, source } from "../shared/read-utils";
import { copilotPaths } from "./paths";

const md = { tool: "copilot", format: "markdown", verified: true } as const;

/** `mcpServers` (Copilot CLI) or `servers` (VS Code style). */
function serversFrom(data: Record<string, unknown> | undefined, src: Source): McpServer[] {
  const record = data?.mcpServers ?? data?.servers;
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record)
    .map(([name, entry]) => mcpFromJson(name, entry, src))
    .filter((s): s is McpServer => s !== null);
}

/** Custom agents are `<name>.agent.md`; plain `.md` files are read too. */
async function readAgents(r: Reader, dir: string, scope: "global" | "project"): Promise<Agent[]> {
  return (await readMarkdownAgents(r, dir, { ...md, scope })).map((a) => ({ ...a, name: a.name.replace(/\.agent$/, "") }));
}

export async function readCopilot(ctx: PathContext): Promise<ToolConfig> {
  const r = new Reader();
  const { global: g, project: p } = copilotPaths(ctx);
  const hasProject = ctx.project !== "";

  const rules = (
    await Promise.all([
      readRootRule(r, g.rulesFile, { ...md, scope: "global" }),
      hasProject ? readRootRule(r, p.rulesFile, { ...md, scope: "project" }) : null,
      hasProject ? readRootRule(r, p.agentsFile, { ...md, scope: "project" }) : null,
    ])
  ).filter((x): x is Rule => x !== null);
  // ~/.copilot/instructions/**/*.instructions.md
  const personal = await readRulesDir(r, g.instructionsDir, { ...md, scope: "global" });
  rules.push(...personal.map((rule) => ({ ...rule, name: rule.name.replace(/\.instructions$/, "") })));
  if (hasProject) {
    // .github/instructions/*.instructions.md, scoped with `applyTo` globs.
    const scoped = await readRulesDir(r, p.instructionsDir, { ...md, scope: "project" });
    rules.push(...scoped.map((rule) => ({ ...rule, name: rule.name.replace(/\.instructions$/, "") })));
  }

  const agents = [...(await readAgents(r, g.agentsDir, "global")), ...(hasProject ? await readAgents(r, p.agentsDir, "project") : [])];
  const skills = [
    ...(await readSkillsDir(r, g.skillsDir, { ...md, scope: "global" })),
    ...(hasProject ? await readSkillsDir(r, p.skillsDir, { ...md, scope: "project" }) : []),
  ];

  const mcpServers = [
    ...serversFrom((await r.json(g.mcpConfig)) as Record<string, unknown> | undefined, source("copilot", "global", g.mcpConfig, "json")),
    ...(hasProject
      ? serversFrom((await r.json(p.mcpConfig)) as Record<string, unknown> | undefined, source("copilot", "project", p.mcpConfig, "json"))
      : []),
  ];

  return { tool: "copilot", rules, agents: agents.sort(byName), skills: skills.sort(byName), commands: [], mcpServers: mcpServers.sort(byName), issues: r.issues };
}
