// Agent Forge's own storage (~/.agent-forge). This is app-owned data, never a tool's config.
//
//   ~/.agent-forge/
//     source/subagents/<name>.md   app-managed agents, in rulesync source format
//     source/skills/<name>/SKILL.md app-managed skills, in rulesync source format
//     backups/<apply-id>/          originals saved before each apply + manifest.json
//     state.json                   files currently owned by Agent Forge (path → hash)
//     projects/<id>/               the same layout for one project (ctx.project set),
//                                  plus project.json naming the project folder
//
// The scope is chosen by `ctx.project`: "" = global (~), a path = that project.
// Project originals stay on this computer; only generated files go into the project.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  MANAGED_NAME,
  RESERVED_SKILL_NAMES,
  RULESYNC_TARGET,
  WRITABLE_AGENT_TOOLS,
  type ManagedAgent,
  type ManagedSkill,
  type ToolId,
} from "@agent-forge/model";
import { Reader, splitFrontmatter, str, stringList } from "../shared/read-utils";
import type { PathContext } from "../types";

export function forgeHome(ctx: PathContext): string {
  return ctx.env.AGENT_FORGE_HOME ?? join(ctx.home, ".agent-forge");
}

/** Folder name for a project: readable name + hash of the full path. */
export function projectId(project: string): string {
  const name = basename(project).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";
  return `${name}-${createHash("sha256").update(project).digest("hex").slice(0, 12)}`;
}

export function forgePaths(ctx: PathContext) {
  const root = forgeHome(ctx);
  const scopeRoot = ctx.project ? join(root, "projects", projectId(ctx.project)) : root;
  return {
    root,
    /** Folder of the current scope (root itself for global). */
    scopeRoot,
    source: join(scopeRoot, "source"),
    agents: join(scopeRoot, "source", "subagents"),
    skills: join(scopeRoot, "source", "skills"),
    backups: join(scopeRoot, "backups"),
    state: join(scopeRoot, "state.json"),
  };
}

/** Writes via a temp file + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, content: string | Buffer, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.agent-forge-${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, content, mode === undefined ? undefined : { mode });
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export function assertValidName(name: string): void {
  if (!MANAGED_NAME.test(name)) {
    throw new Error("Name must start with a letter or digit and contain only letters, digits, '-' or '_' (max 64).");
  }
}

const RULESYNC_TO_TOOL = Object.fromEntries(Object.entries(RULESYNC_TARGET).map(([k, v]) => [v, k as ToolId]));

/** Serializes to the rulesync subagent format. */
export function toRulesyncAgent(agent: ManagedAgent): string {
  const front: Record<string, unknown> = {
    name: agent.name,
    description: agent.description,
    targets: agent.targets.map((t) => RULESYNC_TARGET[t]),
  };
  const claude: Record<string, unknown> = {};
  if (agent.model) claude.model = agent.model;
  if (agent.tools?.length) claude.tools = agent.tools.join(", ");
  if (Object.keys(claude).length) front.claudecode = claude;
  const body = agent.body.endsWith("\n") ? agent.body : `${agent.body}\n`;
  return `---\n${stringifyYaml(front)}---\n${body}`;
}

function fromRulesyncAgent(reader: Reader, path: string, text: string): ManagedAgent {
  const { data, body } = splitFrontmatter(reader, path, text);
  const claude = (data.claudecode ?? {}) as Record<string, unknown>;
  const targets = (stringList(data.targets) ?? [])
    .map((t) => RULESYNC_TO_TOOL[t])
    .filter((t): t is ToolId => Boolean(t));
  return {
    name: str(data.name) ?? "",
    description: str(data.description) ?? "",
    body,
    model: str(claude.model),
    tools: stringList(claude.tools),
    targets,
  };
}

export async function listAgents(ctx: PathContext): Promise<ManagedAgent[]> {
  const { agents } = forgePaths(ctx);
  const reader = new Reader();
  const out: ManagedAgent[] = [];
  for (const path of await reader.filesWithSuffix(agents, ".md")) {
    const text = await reader.text(path);
    if (text !== null) out.push(fromRulesyncAgent(reader, path, text));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function normalize(agent: ManagedAgent): ManagedAgent {
  const targets = [...new Set(agent.targets)].filter((t) => WRITABLE_AGENT_TOOLS.includes(t));
  const tools = agent.tools?.map((t) => t.trim()).filter(Boolean);
  return {
    name: agent.name.trim(),
    description: agent.description.trim(),
    body: agent.body,
    model: agent.model?.trim() || undefined,
    tools: tools?.length ? tools : undefined,
    targets,
  };
}

/** Creates or updates an agent. `previousName` renames an existing one. */
export async function saveAgent(ctx: PathContext, input: ManagedAgent, previousName?: string): Promise<ManagedAgent> {
  const agent = normalize(input);
  assertValidName(agent.name);
  if (!agent.description) throw new Error("Description is required.");
  if (agent.targets.length === 0) throw new Error("Select at least one tool.");
  if (previousName !== undefined) assertValidName(previousName);

  const { agents } = forgePaths(ctx);
  const existing = await listAgents(ctx);
  const clash = existing.some(
    (a) => a.name.toLowerCase() === agent.name.toLowerCase() && a.name !== previousName,
  );
  if (clash) throw new Error(`An agent named "${agent.name}" already exists.`);

  await writeFileAtomic(join(agents, `${agent.name}.md`), toRulesyncAgent(agent));
  if (previousName && previousName !== agent.name) await rm(join(agents, `${previousName}.md`), { force: true });
  return agent;
}

export async function deleteAgent(ctx: PathContext, name: string): Promise<void> {
  assertValidName(name);
  await rm(join(forgePaths(ctx).agents, `${name}.md`), { force: true });
}

// ---------------------------------------------------------------------------
// skills

function assertValidSkillName(name: string): void {
  assertValidName(name);
  if (RESERVED_SKILL_NAMES.includes(name.toLowerCase())) throw new Error(`"${name}" is reserved by the tools. Choose another name.`);
}

/** Serializes to the rulesync skill format (SKILL.md with frontmatter). */
export function toRulesyncSkill(skill: ManagedSkill): string {
  const front = {
    name: skill.name,
    description: skill.description,
    targets: skill.targets.map((t) => RULESYNC_TARGET[t]),
  };
  const body = skill.body.endsWith("\n") ? skill.body : `${skill.body}\n`;
  return `---\n${stringifyYaml(front)}---\n${body}`;
}

export async function listSkills(ctx: PathContext): Promise<ManagedSkill[]> {
  const { skills } = forgePaths(ctx);
  const reader = new Reader();
  const out: ManagedSkill[] = [];
  for (const entry of await reader.entries(skills)) {
    if (!entry.isDir) continue;
    const path = join(entry.path, "SKILL.md");
    const text = await reader.text(path);
    if (text === null) continue;
    const { data, body } = splitFrontmatter(reader, path, text);
    out.push({
      name: str(data.name) ?? entry.name,
      description: str(data.description) ?? "",
      body,
      targets: (stringList(data.targets) ?? []).map((t) => RULESYNC_TO_TOOL[t]).filter((t): t is ToolId => Boolean(t)),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSkill(ctx: PathContext, input: ManagedSkill, previousName?: string): Promise<ManagedSkill> {
  const skill: ManagedSkill = {
    name: input.name.trim(),
    description: input.description.trim(),
    body: input.body,
    targets: [...new Set(input.targets)].filter((t) => WRITABLE_AGENT_TOOLS.includes(t)),
  };
  assertValidSkillName(skill.name);
  if (!skill.description) throw new Error("Description is required.");
  if (skill.targets.length === 0) throw new Error("Select at least one tool.");
  if (previousName !== undefined) assertValidName(previousName);

  const { skills } = forgePaths(ctx);
  const existing = await listSkills(ctx);
  if (existing.some((s) => s.name.toLowerCase() === skill.name.toLowerCase() && s.name !== previousName)) {
    throw new Error(`A skill named "${skill.name}" already exists.`);
  }
  await writeFileAtomic(join(skills, skill.name, "SKILL.md"), toRulesyncSkill(skill));
  if (previousName && previousName !== skill.name) await rm(join(skills, previousName), { recursive: true, force: true });
  return skill;
}

export async function deleteSkill(ctx: PathContext, name: string): Promise<void> {
  assertValidName(name);
  await rm(join(forgePaths(ctx).skills, name), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// state: which tool files Agent Forge currently owns

export interface ForgeState {
  /** Absolute path → sha256 of the content Agent Forge last wrote. */
  managed: Record<string, string>;
}

export async function readState(ctx: PathContext): Promise<ForgeState> {
  try {
    const parsed = JSON.parse(await readFile(forgePaths(ctx).state, "utf8")) as Partial<ForgeState>;
    return { managed: parsed.managed ?? {} };
  } catch {
    return { managed: {} };
  }
}

export async function writeState(ctx: PathContext, state: ForgeState): Promise<void> {
  await writeFileAtomic(forgePaths(ctx).state, `${JSON.stringify(state, null, 2)}\n`);
}

export async function ensureForgeDirs(ctx: PathContext): Promise<void> {
  const p = forgePaths(ctx);
  await mkdir(p.agents, { recursive: true });
  await mkdir(p.skills, { recursive: true });
  await mkdir(p.backups, { recursive: true });
  // So a person browsing ~/.agent-forge/projects can tell which folder is which.
  if (ctx.project) await writeFileAtomic(join(p.scopeRoot, "project.json"), `${JSON.stringify({ path: ctx.project }, null, 2)}\n`);
}

export async function listBackupIds(ctx: PathContext): Promise<string[]> {
  try {
    return (await readdir(forgePaths(ctx).backups)).filter((n) => !n.startsWith(".")).sort().reverse();
  } catch {
    return [];
  }
}
