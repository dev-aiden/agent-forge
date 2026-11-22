// Agent Forge's own storage (~/.agent-forge). This is app-owned data, never a tool's config.
//
//   ~/.agent-forge/
//     source/subagents/<name>.md   app-managed agents, in rulesync source format
//     backups/<apply-id>/          originals saved before each apply + manifest.json
//     state.json                   files currently owned by Agent Forge (path → hash)
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  MANAGED_NAME,
  RULESYNC_TARGET,
  WRITABLE_AGENT_TOOLS,
  type ManagedAgent,
  type ToolId,
} from "@agent-forge/model";
import { Reader, splitFrontmatter, str, stringList } from "../shared/read-utils";
import type { PathContext } from "../types";

export function forgeHome(ctx: PathContext): string {
  return ctx.env.AGENT_FORGE_HOME ?? join(ctx.home, ".agent-forge");
}

export function forgePaths(ctx: PathContext) {
  const root = forgeHome(ctx);
  return {
    root,
    source: join(root, "source"),
    agents: join(root, "source", "subagents"),
    backups: join(root, "backups"),
    state: join(root, "state.json"),
  };
}

/** Writes via a temp file + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.agent-forge-${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, content);
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
  await mkdir(p.backups, { recursive: true });
}

export async function listBackupIds(ctx: PathContext): Promise<string[]> {
  try {
    return (await readdir(forgePaths(ctx).backups)).filter((n) => !n.startsWith(".")).sort().reverse();
  } catch {
    return [];
  }
}
