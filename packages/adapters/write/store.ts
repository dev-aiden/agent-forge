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
  const claude: Record<string, unknown> = { ...agent.claudeExtra };
  if (agent.model) claude.model = agent.model;
  if (agent.tools?.length) claude.tools = agent.tools.join(", ");
  if (Object.keys(claude).length) front.claudecode = claude;
  if (agent.codexExtra && Object.keys(agent.codexExtra).length) front.codexcli = agent.codexExtra;
  const body = agent.body.endsWith("\n") ? agent.body : `${agent.body}\n`;
  return `---\n${stringifyYaml(front)}---\n${body}`;
}

function fromRulesyncAgent(reader: Reader, path: string, text: string): ManagedAgent {
  const { data, body } = splitFrontmatter(reader, path, text);
  const { model, tools, ...claudeExtra } = (data.claudecode ?? {}) as Record<string, unknown>;
  // Explicitly empty tools ("no tools") cannot be shown in the form; keep it as an extra.
  if (tools !== undefined && stringList(tools) === undefined) claudeExtra.tools = tools;
  const codexExtra = (data.codexcli ?? {}) as Record<string, unknown>;
  const targets = (stringList(data.targets) ?? [])
    .map((t) => RULESYNC_TO_TOOL[t])
    .filter((t): t is ToolId => Boolean(t));
  return {
    name: str(data.name) ?? "",
    description: str(data.description) ?? "",
    body,
    model: str(model),
    tools: stringList(tools),
    targets,
    ...(Object.keys(claudeExtra).length ? { claudeExtra } : {}),
    ...(Object.keys(codexExtra).length ? { codexExtra } : {}),
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
    ...(agent.claudeExtra && Object.keys(agent.claudeExtra).length ? { claudeExtra: agent.claudeExtra } : {}),
    ...(agent.codexExtra && Object.keys(agent.codexExtra).length ? { codexExtra: agent.codexExtra } : {}),
  };
}

/**
 * Creates or updates an agent. `previousName` renames an existing one.
 * Tool-specific extras cannot be set from the app: they are kept from the stored agent.
 */
export async function saveAgent(ctx: PathContext, input: ManagedAgent, previousName?: string): Promise<ManagedAgent> {
  const stored = previousName === undefined ? undefined : (await listAgents(ctx)).find((a) => a.name === previousName);
  return writeAgent(ctx, { ...input, claudeExtra: stored?.claudeExtra, codexExtra: stored?.codexExtra }, previousName);
}

/** Saves an agent including its extras (used by import). */
export async function writeAgent(ctx: PathContext, input: ManagedAgent, previousName?: string): Promise<ManagedAgent> {
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
    ...skill.extra,
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
    const { name, description, targets, ...extra } = data;
    const files = await bundledFiles(entry.path);
    out.push({
      name: str(name) ?? entry.name,
      description: str(description) ?? "",
      body,
      targets: (stringList(targets) ?? []).map((t) => RULESYNC_TO_TOOL[t]).filter((t): t is ToolId => Boolean(t)),
      ...(Object.keys(extra).length ? { extra } : {}),
      ...(files.length ? { files } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Files in a skill folder besides SKILL.md, as sorted relative POSIX paths. */
async function bundledFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (!e.isFile() || e.name === ".DS_Store") continue;
    const rel = join(e.parentPath, e.name).slice(dir.length + 1).replaceAll("\\", "/");
    if (rel !== "SKILL.md") out.push(rel);
  }
  return out.sort();
}

/**
 * Creates or updates a skill. Frontmatter extras and bundled files cannot be set
 * from the app: they are kept from the stored skill (and move with a rename).
 */
export async function saveSkill(ctx: PathContext, input: ManagedSkill, previousName?: string): Promise<ManagedSkill> {
  const stored = previousName === undefined ? undefined : (await listSkills(ctx)).find((s) => s.name === previousName);
  return writeSkill(ctx, { ...input, extra: stored?.extra }, previousName);
}

/** Saves a skill including its frontmatter extras (used by import). Bundled files are copied separately. */
export async function writeSkill(ctx: PathContext, input: ManagedSkill, previousName?: string): Promise<ManagedSkill> {
  const skill: ManagedSkill = {
    name: input.name.trim(),
    description: input.description.trim(),
    body: input.body,
    targets: [...new Set(input.targets)].filter((t) => WRITABLE_AGENT_TOOLS.includes(t)),
    ...(input.extra && Object.keys(input.extra).length ? { extra: input.extra } : {}),
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
  // Rename moves the whole folder so bundled files come along.
  if (previousName && previousName !== skill.name) {
    await mkdir(skills, { recursive: true });
    await rename(join(skills, previousName), join(skills, skill.name)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  await writeFileAtomic(join(skills, skill.name, "SKILL.md"), toRulesyncSkill(skill));
  const files = await bundledFiles(join(skills, skill.name));
  return files.length ? { ...skill, files } : skill;
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
