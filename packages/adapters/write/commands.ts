// Custom commands (Claude Code `commands/*.md`) and prompts (Codex `prompts/*.md`)
// moved into Kitroom skills. Both tools now recommend skills: Claude Code merged
// commands into skills, Codex deprecated custom prompts.
//
// Moving writes a Kitroom skill only. When asked, the original file is queued in
// retired.json and deleted by the next apply (preview, backup and undo as usual).
import { readFile } from "node:fs/promises";
import { MANAGED_NAME, RESERVED_SKILL_NAMES, type Command, type ManagedSkill } from "@kitroom/model";
import { readClaude } from "../claude/read";
import { readCodex } from "../codex/read";
import type { PathContext } from "../types";
import { SKILL_KEYS, SKILL_TOP_LEVEL } from "./import";
import { sha256 } from "./pipeline";
import { listSkills, readRetired, writeRetired, writeSkill } from "./store";

export type CommandTool = "claude" | "codex";

export type CommandBlockReason = "invalid-name" | "skill-exists" | "unsupported-fields";

export interface LegacyCommand {
  tool: CommandTool;
  name: string;
  description?: string;
  /** Shown to the user; never sent back (moveCommand takes tool + name). */
  path: string;
  verified: boolean;
  /** Why it cannot be moved. */
  blocked?: CommandBlockReason;
  /** Already moved: the next apply deletes this file. */
  removalPlanned: boolean;
  /** Uses argument placeholders ($ARGUMENTS, $1...). Skills for Codex do not fill them in. */
  usesArguments: boolean;
}

export interface MoveCommandResult {
  skill: ManagedSkill;
  removalPlanned: boolean;
  usesArguments: boolean;
}

/** Frontmatter keys a command may have that a skill keeps. `name`/`paths` are skill-only. */
const COMMAND_KEYS: Record<CommandTool, Set<string>> = {
  claude: new Set([...SKILL_KEYS.claude].filter((k) => k !== "paths")),
  codex: new Set(["argument-hint"]),
};

const ARGUMENTS = /\$(ARGUMENTS\b|[0-9]\b|[A-Z][A-Z0-9_]*\b)/;

async function commandsInScope(ctx: PathContext): Promise<[CommandTool, Command][]> {
  const scope = ctx.project ? "project" : "global";
  const [claude, codex] = await Promise.all([readClaude(ctx), readCodex(ctx)]);
  return [
    ...claude.commands.filter((c) => c.source.scope === scope).map((c) => ["claude", c] as [CommandTool, Command]),
    ...codex.commands.filter((c) => c.source.scope === scope).map((c) => ["codex", c] as [CommandTool, Command]),
  ];
}

/** Skill names already taken in this scope: Kitroom's own and the tools' (lowercase). */
async function takenSkillNames(ctx: PathContext): Promise<Set<string>> {
  const scope = ctx.project ? "project" : "global";
  const [managed, claude, codex] = await Promise.all([listSkills(ctx), readClaude(ctx), readCodex(ctx)]);
  const names = [...managed.map((s) => s.name), ...[...claude.skills, ...codex.skills].filter((s) => s.source.scope === scope).map((s) => s.name)];
  return new Set(names.map((n) => n.toLowerCase()));
}

function blockReason(tool: CommandTool, c: Command, taken: Set<string>): CommandBlockReason | undefined {
  if (!MANAGED_NAME.test(c.name) || RESERVED_SKILL_NAMES.includes(c.name.toLowerCase())) return "invalid-name";
  if (taken.has(c.name.toLowerCase())) return "skill-exists";
  if (Object.keys(c.extra).some((k) => !COMMAND_KEYS[tool].has(k))) return "unsupported-fields";
  return undefined;
}

/** Commands and prompts of the current scope, with whether each can be moved. */
export async function listLegacyCommands(ctx: PathContext): Promise<LegacyCommand[]> {
  const [found, taken, retired] = await Promise.all([commandsInScope(ctx), takenSkillNames(ctx), readRetired(ctx)]);
  const planned = new Set(retired.map((r) => r.path));
  return found.map(([tool, c]) => ({
    tool,
    name: c.name,
    description: c.description,
    path: c.source.path,
    verified: c.source.verified,
    blocked: blockReason(tool, c, taken),
    removalPlanned: planned.has(c.source.path),
    usesArguments: ARGUMENTS.test(c.body),
  }));
}

/** Claude Code falls back to the first paragraph when a command has no description. */
function firstLine(body: string): string {
  const line = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** Skill frontmatter (rulesync form) for a command's frontmatter. */
function skillExtra(tool: CommandTool, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const claude: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (SKILL_TOP_LEVEL.has(k)) out[k] = v;
    else claude[k] = v;
  }
  // A Codex prompt runs only when typed; keep it that way as a skill.
  if (tool === "codex") out["disable-model-invocation"] = true;
  if (Object.keys(claude).length) out.claudecode = claude;
  return out;
}

/**
 * Creates a Kitroom skill from a command of the current scope, for the same tool.
 * With `removeOriginal`, the next apply deletes the command file (if unchanged by then).
 */
export async function moveCommand(ctx: PathContext, tool: CommandTool, name: string, removeOriginal: boolean): Promise<MoveCommandResult> {
  if (tool !== "claude" && tool !== "codex") throw new Error("unknown tool");
  const found = (await commandsInScope(ctx)).find(([t, c]) => t === tool && c.name === name)?.[1];
  if (!found) throw new Error(`Command "${name}" was not found.`);
  const blocked = blockReason(tool, found, await takenSkillNames(ctx));
  if (blocked) throw new Error(`Command "${name}" cannot be moved (${blocked}).`);
  const description = found.description?.trim() || firstLine(found.body);
  if (!description) throw new Error(`Command "${name}" is empty.`);

  await writeSkill(ctx, { name, description, body: found.body.replace(/^\s*\n/, ""), targets: [tool], extra: skillExtra(tool, found.extra) });
  const skill = (await listSkills(ctx)).find((s) => s.name === name)!;

  if (removeOriginal) {
    const hash = sha256(await readFile(found.source.path, "utf8"));
    const retired = (await readRetired(ctx)).filter((r) => r.path !== found.source.path);
    await writeRetired(ctx, [...retired, { path: found.source.path, hash, skill: name, tool }]);
  }
  return { skill, removalPlanned: removeOriginal, usesArguments: ARGUMENTS.test(found.body) };
}
