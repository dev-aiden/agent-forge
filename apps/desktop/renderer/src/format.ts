import type { Item, Scope } from "@agent-forge/model";

/** Shows paths under the project as `./…` and under home as `~/…`. Works with / and \ separators. */
export function makeShortPath(home: string, project: string | null) {
  return (path: string): string => {
    if (project && (path === project || path.startsWith(project + "/") || path.startsWith(project + "\\"))) {
      return "." + path.slice(project.length);
    }
    if (home && (path === home || path.startsWith(home + "/") || path.startsWith(home + "\\"))) {
      return "~" + path.slice(home.length);
    }
    return path;
  };
}

export const KIND_LABEL: Record<Item["kind"], string> = {
  rule: "Rule",
  agent: "Agent",
  skill: "Skill",
  mcp: "MCP server",
};

export const SCOPE_STYLE: Record<Scope, string> = {
  global: "border-sky-800 text-sky-300",
  project: "border-emerald-800 text-emerald-300",
  local: "border-amber-800 text-amber-300",
};
