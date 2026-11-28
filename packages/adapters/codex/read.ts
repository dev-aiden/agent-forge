// Reads Codex CLI rules, agents, skills, custom prompts and MCP servers into the common model. Read-only.
import { basename } from "node:path";
import type { Agent, McpServer, Rule, Source, ToolConfig } from "@kitroom/model";
import type { PathContext } from "../types";
import {
  byName,
  itemId,
  omit,
  readCommandsDir,
  readRootRule,
  readSkillsDir,
  Reader,
  source,
  str,
  stringList,
  stringRecord,
} from "../shared/read-utils";
import { codexPaths } from "./paths";

const md = { tool: "codex", format: "markdown", verified: true } as const;

/** [mcp_servers.<name>] tables from config.toml. */
function serversFromToml(config: Record<string, unknown> | undefined, src: Source): McpServer[] {
  const table = config?.mcp_servers;
  if (!table || typeof table !== "object" || Array.isArray(table)) return [];
  return Object.entries(table as Record<string, unknown>).flatMap(([name, value]): McpServer[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const e = value as Record<string, unknown>;
    const url = str(e.url);
    return [
      {
        kind: "mcp",
        id: itemId(src, name),
        name,
        transport: url ? "http" : "stdio",
        command: str(e.command),
        args: stringList(Array.isArray(e.args) ? e.args : undefined),
        env: stringRecord(e.env),
        url,
        headers: stringRecord(e.http_headers),
        enabled: e.enabled !== false,
        extra: omit(e, ["command", "args", "env", "url", "http_headers", "enabled"]),
        source: src,
      },
    ];
  });
}

/** Custom agents as TOML files (one per agent). Older key names are accepted too. */
async function readTomlAgents(r: Reader, dir: string, scope: "global" | "project"): Promise<Agent[]> {
  const agents: Agent[] = [];
  for (const path of await r.filesWithSuffix(dir, ".toml")) {
    const data = await r.toml(path);
    if (!data) continue;
    const src = source("codex", scope, path, "toml");
    agents.push({
      kind: "agent",
      id: itemId(src),
      name: str(data.name) ?? basename(path, ".toml"),
      description: str(data.description),
      body: str(data.developer_instructions) ?? str(data.instructions) ?? str(data.prompt) ?? "",
      model: str(data.model),
      tools: stringList(data.tools),
      extra: omit(data, ["name", "description", "developer_instructions", "instructions", "prompt", "model", "tools"]),
      source: src,
    });
  }
  return agents;
}

export async function readCodex(ctx: PathContext): Promise<ToolConfig> {
  const r = new Reader();
  const { global: g, project: p } = codexPaths(ctx);

  // Codex prefers AGENTS.override.md over AGENTS.md in the same directory; both are listed.
  // Project scope is skipped when no project is selected.
  const hasProject = ctx.project !== "";

  const rules = (
    await Promise.all([
      readRootRule(r, g.overrideRulesFile, { ...md, scope: "global" }),
      readRootRule(r, g.rulesFile, { ...md, scope: "global" }),
      hasProject ? readRootRule(r, p.overrideRulesFile, { ...md, scope: "project" }) : null,
      hasProject ? readRootRule(r, p.rulesFile, { ...md, scope: "project" }) : null,
    ])
  ).filter((x): x is Rule => x !== null);

  const agents = [
    ...(await readTomlAgents(r, g.agentsDir, "global")),
    ...(hasProject ? await readTomlAgents(r, p.agentsDir, "project") : []),
  ];

  const skills = [
    ...(await readSkillsDir(r, g.skillsDir, { ...md, scope: "global" })),
    ...(await readSkillsDir(r, g.legacySkillsDir, { ...md, scope: "global" }, { extra: { legacyLocation: true } })),
    ...(hasProject ? await readSkillsDir(r, p.skillsDir, { ...md, scope: "project" }) : []),
  ];

  // Custom prompts (global only; deprecated upstream in favor of skills).
  const commands = await readCommandsDir(r, g.promptsDir, { ...md, scope: "global" });

  const mcpServers = [
    ...serversFromToml(await r.toml(g.config), source("codex", "global", g.config, "toml")),
    ...(hasProject ? serversFromToml(await r.toml(p.config), source("codex", "project", p.config, "toml")) : []),
  ];

  return {
    tool: "codex",
    rules,
    agents: agents.sort(byName),
    skills: skills.sort(byName),
    commands: commands.sort(byName),
    mcpServers: mcpServers.sort(byName),
    issues: r.issues,
  };
}
