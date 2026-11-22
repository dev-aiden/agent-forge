// Preview → apply → undo for app-managed items.
//
// 1. preview: rulesync generates into a throw-away staging home (separate process).
//    Staged files are compared with the real ones. Nothing real is touched.
//    Shared files rulesync merges into (Codex config.toml) are copied into the
//    staging home first, so keys Agent Forge does not manage are preserved.
// 2. apply:   re-checks that nothing changed since the preview, backs up originals
//    to ~/.agent-forge/backups/<id>/, writes files atomically, then runs the
//    planned Claude Code CLI commands for MCP servers.
// 3. undo:    restores the backup / runs the reverse commands. Anything the user
//    changed after the apply is kept.
//
// Every file path is checked by `assertWritable` before it is written.
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { RULESYNC_TARGET, WRITABLE_AGENT_TOOLS } from "@agent-forge/model";
import { claudePaths } from "../claude/paths";
import { codexPaths } from "../codex/paths";
import { isSensitive } from "../shared/read-utils";
import type { PathContext } from "../types";
import {
  currentClaudeServers,
  planClaudeMcp,
  runClaudeChange,
  sameDef,
  type ClaudeCliRunner,
  type ClaudeMcpDef,
  type CommandChange,
} from "./claude-mcp";
import { readManagedMcp, readManagedRule } from "./config-store";
import {
  ensureForgeDirs,
  forgePaths,
  listAgents,
  listBackupIds,
  listSkills,
  readState,
  writeFileAtomic,
  writeState,
} from "./store";

/** Starts the rulesync worker with the given env and cwd; resolves when it exits with code 0. */
export type WorkerRunner = (job: { env: Record<string, string>; cwd: string }) => Promise<void>;

export type ClaudeUnavailable = "not-found" | "inside-session";

export interface PipelineRunners {
  worker: WorkerRunner;
  /** Runs the Claude Code CLI. Null when it cannot be used (see claudeUnavailable). */
  claude: ClaudeCliRunner | null;
  /** Why `claude` is null. Default: "not-found". */
  claudeUnavailable?: ClaudeUnavailable;
}

export type ChangeAction = "create" | "modify" | "delete" | "unchanged";

export interface Change {
  /** Absolute path of the real file. */
  path: string;
  action: ChangeAction;
  before: string | null;
  after: string | null;
  /** sha256 of `before` (null = file did not exist). Checked again at apply time. */
  beforeHash: string | null;
  /** The file exists but was not written by Agent Forge (it will be replaced). */
  unmanagedOverwrite: boolean;
  /** Only part of a shared file changes; other settings in it are kept. */
  merged: boolean;
}

export type Warning =
  | {
      kind: "unmanaged-mcp";
      tool: "claude" | "codex";
      /** MCP servers configured in the tool but not in Agent Forge: applying removes them. */
      names: string[];
    }
  | {
      /** AGENTS.override.md exists: Codex reads it instead of the AGENTS.md we write. */
      kind: "codex-rule-override";
      path: string;
    }
  | {
      /**
       * Project MCP files change. Claude Code asks before using servers from .mcp.json;
       * Codex reads .codex/config.toml only in trusted projects.
       */
      kind: "project-mcp";
    }
  | {
      /** Literal secret values would be written into project files (often committed to git). */
      kind: "project-mcp-secrets";
      names: string[];
    };

export interface ChangeSet {
  id: string;
  createdAt: string;
  changes: Change[];
  /** Claude Code CLI commands (MCP servers). */
  commands: CommandChange[];
  warnings: Warning[];
  /** Set when commands are planned but the Claude Code CLI cannot be used. */
  blocked?: ClaudeUnavailable;
}

export interface ManifestEntry {
  path: string;
  action: Exclude<ChangeAction, "unchanged">;
  beforeHash: string | null;
  afterHash: string | null;
  /** Backup file name inside the backup folder (for modify / delete). */
  backup: string | null;
  /** Ownership record before this apply (hash in state.json, or null if not owned). */
  previouslyManaged: string | null;
}

export interface CommandEntry {
  tool: "claude";
  name: string;
  before: ClaudeMcpDef | null;
  after: ClaudeMcpDef | null;
}

export interface ApplyManifest {
  id: string;
  createdAt: string;
  entries: ManifestEntry[];
  commands?: CommandEntry[];
  undoneAt?: string;
}

export class ConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`Changed since the preview: ${paths.join(", ")}. Preview again.`);
  }
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const isProject = (ctx: PathContext) => ctx.project !== "";

/**
 * A project folder Agent Forge may write into. Refuses the home folder and its
 * parents (project paths would then hit the global config) and Agent Forge's own folder.
 */
export function assertProjectAllowed(ctx: PathContext): void {
  if (!isProject(ctx)) return;
  const p = ctx.project;
  if (!isAbsolute(p) || resolve(p) !== p) throw new Error(`invalid project folder: ${p}`);
  const home = resolve(ctx.home);
  if (p === home || inside(home, p)) throw new Error("Choose a project folder inside your home folder, not the home folder itself.");
  if (p === forgePaths(ctx).root || inside(p, forgePaths(ctx).root)) throw new Error("This folder belongs to Agent Forge.");
}

/** Folders holding one file per app-managed item. Files here may be created and deleted. */
export function writableRoots(ctx: PathContext): string[] {
  const scope = isProject(ctx) ? "project" : "global";
  const claude = claudePaths(ctx)[scope];
  const codex = codexPaths(ctx)[scope];
  return [claude.agentsDir, claude.skillsDir, codex.agentsDir, codex.skillsDir];
}

/** Individual shared files Agent Forge may update (never delete). */
export function writableFiles(ctx: PathContext): string[] {
  if (isProject(ctx)) {
    const claude = claudePaths(ctx).project;
    const codex = codexPaths(ctx).project;
    return [claude.rulesFile, codex.rulesFile, codex.config, claude.mcpJson];
  }
  const claude = claudePaths(ctx).global;
  const codex = codexPaths(ctx).global;
  return [claude.rulesFile, codex.rulesFile, codex.config];
}

/** Shared files rulesync merges into: the real file is staged first so other keys survive. */
function mergedFiles(ctx: PathContext): string[] {
  return isProject(ctx) ? [codexPaths(ctx).project.config, claudePaths(ctx).project.mcpJson] : [codexPaths(ctx).global.config];
}

/** Folders inside writable roots that belong to someone else (e.g. claude.ai synced skills). */
export function protectedDirs(ctx: PathContext): string[] {
  return isProject(ctx) ? [] : [claudePaths(ctx).global.syncedSkillsDir];
}

export function assertWritable(ctx: PathContext, path: string): void {
  assertProjectAllowed(ctx);
  const abs = resolve(path);
  if (abs !== path) throw new Error(`refusing non-normalized path: ${path}`);
  if (isSensitive(abs)) throw new Error(`refusing to write credential file: ${abs}`);
  const ok = writableFiles(ctx).includes(abs) || writableRoots(ctx).some((root) => inside(abs, root));
  if (!ok) throw new Error(`refusing to write outside tool config folders: ${abs}`);
  if (protectedDirs(ctx).some((dir) => abs === dir || inside(abs, dir))) {
    throw new Error(`refusing to write into a folder managed by another app: ${abs}`);
  }
}

const isItemFile = (ctx: PathContext, path: string) => writableRoots(ctx).some((root) => inside(path, root));

/**
 * After removing a file, removes its now-empty parent folders up to (not
 * including) the writable root, e.g. ~/.claude/skills/<name>/.
 */
async function removeEmptyParents(ctx: PathContext, file: string): Promise<void> {
  const roots = writableRoots(ctx);
  let dir = dirname(file);
  while (roots.some((root) => inside(dir, root))) {
    try {
      await rmdir(dir); // fails unless empty
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

// ---------------------------------------------------------------------------
// preview

export async function preview(ctx: PathContext, runners: PipelineRunners): Promise<ChangeSet> {
  assertProjectAllowed(ctx);
  await ensureForgeDirs(ctx);
  const project = isProject(ctx);
  const forge = forgePaths(ctx);
  const codex = codexPaths(ctx)[project ? "project" : "global"];
  // rulesync writes paths relative to the user's home (global) or the project folder.
  const realRoot = project ? ctx.project : ctx.home;
  const state = await readState(ctx);
  const [agents, skills, rule, mcp] = await Promise.all([
    listAgents(ctx),
    listSkills(ctx),
    readManagedRule(ctx),
    readManagedMcp(ctx),
  ]);

  const features: string[] = [];
  if (agents.length) features.push("subagents");
  if (skills.length) features.push("skills");
  if (rule) features.push("rules");
  if (mcp) features.push("mcp");

  // Generate into a staging home that rulesync treats as "~" (and a staging
  // project folder in project scope). Nothing real is written here.
  const stagingRoot = await mkdtemp(join(tmpdir(), "agent-forge-stage-"));
  try {
    const stagingHome = join(stagingRoot, "home");
    const work = join(stagingRoot, "work");
    const stagingOut = project ? join(stagingRoot, "project") : stagingHome;
    await mkdir(stagingHome);
    await mkdir(work);
    if (project) await mkdir(stagingOut);

    let outputs: string[] = [];
    if (features.length > 0) {
      // rulesync merges MCP into shared files: give it the real ones so other keys survive.
      if (mcp) {
        for (const real of mergedFiles(ctx)) {
          if ((await readOrNull(real)) === null) continue;
          const staged = resolve(stagingOut, relative(realRoot, real));
          await mkdir(dirname(staged), { recursive: true });
          await copyFile(real, staged);
        }
      }
      const resultPath = join(stagingRoot, "result.json");
      const job = {
        stagingRoot,
        stagingHome,
        inputRoot: forge.source,
        targets: WRITABLE_AGENT_TOOLS.map((t) => RULESYNC_TARGET[t]),
        features,
        global: !project,
        outputRoot: stagingOut,
      };
      await runners.worker({
        cwd: project ? stagingOut : work,
        env: {
          AGENT_FORGE_JOB: JSON.stringify(job),
          AGENT_FORGE_RESULT: resultPath,
          HOME: stagingHome,
          HOME_DIR: stagingHome,
          USERPROFILE: stagingHome,
          XDG_CONFIG_HOME: join(stagingHome, ".config"),
          PATH: process.env.PATH ?? "",
        },
      });
      outputs = (JSON.parse(await readFile(resultPath, "utf8")) as { outputs: string[] }).outputs;
    }

    const claudeUserJson = claudePaths(ctx).global.userJson;
    const merged = new Set(mergedFiles(ctx));
    const changes: Change[] = [];
    const produced = new Set<string>();

    for (const rel of outputs) {
      const staged = resolve(stagingOut, rel);
      if (!inside(staged, stagingOut)) throw new Error(`rulesync produced a path outside the staging folder: ${rel}`);
      const path = resolve(realRoot, rel);
      // Claude Code user MCP is applied through its CLI, never by writing ~/.claude.json.
      if (path === claudeUserJson) continue;
      assertWritable(ctx, path);
      produced.add(path);

      const after = await readFile(staged, "utf8");
      const before = await readOrNull(path);
      if (before === null && after.trim() === "") continue; // nothing worth creating
      const beforeHash = before === null ? null : sha256(before);
      const isMerged = merged.has(path);
      changes.push({
        path,
        action: before === null ? "create" : before === after ? "unchanged" : "modify",
        before,
        after,
        beforeHash,
        unmanagedOverwrite: !isMerged && before !== null && before !== after && state.managed[path] !== beforeHash,
        merged: isMerged,
      });
    }

    // Item files Agent Forge wrote earlier that are no longer produced → remove them,
    // unless the user edited them since. Shared files are never deleted.
    for (const [path, hash] of Object.entries(state.managed)) {
      if (produced.has(path) || !isItemFile(ctx, path)) continue;
      assertWritable(ctx, path);
      const before = await readOrNull(path);
      if (before === null || sha256(before) !== hash) continue;
      changes.push({ path, action: "delete", before, after: null, beforeHash: hash, unmanagedOverwrite: false, merged: false });
    }
    changes.sort((a, b) => a.path.localeCompare(b.path));

    // MCP: Claude Code user scope through its CLI (project scope is the .mcp.json file),
    // plus warnings for servers that would disappear.
    const commands = mcp && !project ? await planClaudeMcp(ctx, mcp) : [];
    const warnings: Warning[] = [];
    if (mcp) {
      const known = new Set(mcp.map((s) => s.name));
      const claudeReal = project
        ? Object.keys(parseJsonObject(await readOrNull(claudePaths(ctx).project.mcpJson)).mcpServers ?? {})
        : commands.filter((c) => c.unmanaged).map((c) => c.name);
      const claudeUnmanaged = claudeReal.filter((n) => !known.has(n));
      if (claudeUnmanaged.length) warnings.push({ kind: "unmanaged-mcp", tool: "claude", names: claudeUnmanaged });

      const { parse } = await import("smol-toml");
      const text = await readOrNull(codex.config);
      let real: string[] = [];
      try {
        real = Object.keys(((text ? parse(text) : {}) as { mcp_servers?: object }).mcp_servers ?? {});
      } catch {
        // unparsable config: the diff shows it
      }
      const codexUnmanaged = real.filter((n) => !known.has(n));
      if (codexUnmanaged.length) warnings.push({ kind: "unmanaged-mcp", tool: "codex", names: codexUnmanaged });

      if (project && changes.some((c) => merged.has(c.path) && c.action !== "unchanged")) {
        warnings.push({ kind: "project-mcp" });
        const literal = mcp.filter((s) => hasLiteralSecret(s.env) || hasLiteralSecret(s.headers)).map((s) => s.name);
        if (literal.length) warnings.push({ kind: "project-mcp-secrets", names: literal });
      }
    }

    if (rule?.targets.includes("codex") && (await readOrNull(codex.overrideRulesFile)) !== null) {
      warnings.push({ kind: "codex-rule-override", path: codex.overrideRulesFile });
    }

    const pendingCommands = commands.some((c) => c.action !== "unchanged");
    return {
      id: newApplyId(),
      createdAt: new Date().toISOString(),
      changes,
      commands,
      warnings,
      blocked: pendingCommands && !runners.claude ? (runners.claudeUnavailable ?? "not-found") : undefined,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function parseJsonObject(text: string | null): { mcpServers?: Record<string, unknown> } {
  try {
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** A value written as-is (not an environment reference like ${TOKEN}). */
function hasLiteralSecret(record?: Record<string, string>): boolean {
  return Object.values(record ?? {}).some((v) => v.trim() !== "" && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim()) && !/^Bearer \$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim()));
}

function newApplyId(): string {
  // Sortable by time, unique, file-name safe.
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// apply

export async function apply(ctx: PathContext, set: ChangeSet, runners: Pick<PipelineRunners, "claude">): Promise<ApplyManifest> {
  assertProjectAllowed(ctx);
  const pending = set.changes.filter((c) => c.action !== "unchanged");
  const commands = set.commands.filter((c) => c.action !== "unchanged");
  if (set.blocked) throw new Error(`Claude Code CLI cannot be used (${set.blocked}).`);
  if (commands.length && !runners.claude) throw new Error("Claude Code CLI is not available.");
  for (const c of pending) assertWritable(ctx, c.path);

  // Refuse if anything changed since the preview.
  const conflicts: string[] = [];
  for (const c of pending) {
    const now = await readOrNull(c.path);
    if ((now === null ? null : sha256(now)) !== c.beforeHash) conflicts.push(c.path);
  }
  if (commands.length) {
    const current = await currentClaudeServers(ctx);
    for (const c of commands) if (!sameDef(current.get(c.name) ?? null, c.before)) conflicts.push(`Claude Code MCP "${c.name}"`);
  }
  if (conflicts.length) throw new ConflictError(conflicts);

  // Backups may contain secrets (MCP config): user-only permissions.
  const dir = join(forgePaths(ctx).backups, set.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const state = await readState(ctx);

  // Back up everything first, then write.
  const entries: ManifestEntry[] = [];
  for (const [i, c] of pending.entries()) {
    let backup: string | null = null;
    if (c.before !== null) {
      backup = `${String(i).padStart(3, "0")}.bak`;
      await writeFileAtomic(join(dir, backup), c.before, 0o600);
    }
    entries.push({
      path: c.path,
      action: c.action as ManifestEntry["action"],
      beforeHash: c.beforeHash,
      afterHash: c.after === null ? null : sha256(c.after),
      backup,
      previouslyManaged: state.managed[c.path] ?? null,
    });
  }
  const commandEntries: CommandEntry[] = commands.map((c) => ({ tool: c.tool, name: c.name, before: c.before, after: c.after }));
  const manifest: ApplyManifest = { id: set.id, createdAt: new Date().toISOString(), entries, commands: commandEntries };
  await writeFileAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), 0o600);

  const doneFiles: Change[] = [];
  const doneCommands: CommandEntry[] = [];
  try {
    for (const c of pending) {
      if (c.action === "delete") {
        await unlink(c.path);
        await removeEmptyParents(ctx, c.path);
      } else await writeFileAtomic(c.path, c.after!);
      doneFiles.push(c);
    }
    for (const c of commandEntries) {
      await runClaudeChange(runners.claude!, c.name, c.before, c.after);
      doneCommands.push(c);
    }
  } catch (e) {
    // Roll back what was already done, newest first.
    const rollbackErrors: string[] = [];
    for (const c of doneCommands.reverse()) {
      await runClaudeChange(runners.claude!, c.name, c.after, c.before).catch((err: Error) => rollbackErrors.push(`${c.name}: ${err.message}`));
    }
    for (const c of doneFiles.reverse()) {
      try {
        if (c.before === null) {
          await rm(c.path, { force: true });
          await removeEmptyParents(ctx, c.path);
        } else await writeFileAtomic(c.path, c.before);
      } catch (err) {
        rollbackErrors.push(`${c.path}: ${(err as Error).message}`);
      }
    }
    if (rollbackErrors.length === 0) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
    // Keep the backup so nothing is lost; the manifest lists what was there before.
    throw new Error(`${(e as Error).message}. Rolling back failed for: ${rollbackErrors.join("; ")}. Originals are kept in ${dir}.`);
  }

  for (const e of entries) {
    if (e.afterHash === null) delete state.managed[e.path];
    else state.managed[e.path] = e.afterHash;
  }
  // Unchanged files produced by this apply are owned too.
  for (const c of set.changes) if (c.action === "unchanged" && c.after !== null) state.managed[c.path] = sha256(c.after);
  await writeState(ctx, state);

  return manifest;
}

// ---------------------------------------------------------------------------
// undo & history

export interface UndoResult {
  restored: string[];
  /** Files / servers changed by the user after the apply; left as they are. */
  skipped: string[];
}

async function readManifest(ctx: PathContext, id: string): Promise<ApplyManifest> {
  if (!/^[0-9A-Za-z-]+$/.test(id)) throw new Error("invalid apply id");
  return JSON.parse(await readFile(join(forgePaths(ctx).backups, id, "manifest.json"), "utf8")) as ApplyManifest;
}

export async function undo(ctx: PathContext, id: string, runners: Pick<PipelineRunners, "claude">): Promise<UndoResult> {
  const manifest = await readManifest(ctx, id);
  if (manifest.undoneAt) throw new Error("This apply was already undone.");
  const dir = join(forgePaths(ctx).backups, id);
  const state = await readState(ctx);
  const result: UndoResult = { restored: [], skipped: [] };

  const commands = manifest.commands ?? [];
  if (commands.length) {
    if (!runners.claude) throw new Error("Claude Code CLI is not available to undo MCP changes.");
    const current = await currentClaudeServers(ctx);
    for (const c of [...commands].reverse()) {
      const label = `Claude Code MCP "${c.name}"`;
      if (!sameDef(current.get(c.name) ?? null, c.after)) {
        result.skipped.push(label);
        continue;
      }
      await runClaudeChange(runners.claude, c.name, c.after, c.before);
      result.restored.push(label);
    }
  }

  for (const e of [...manifest.entries].reverse()) {
    assertWritable(ctx, e.path);
    const now = await readOrNull(e.path);
    const nowHash = now === null ? null : sha256(now);
    if (nowHash !== e.afterHash) {
      result.skipped.push(e.path);
      continue;
    }
    if (e.backup === null) {
      await rm(e.path, { force: true });
      await removeEmptyParents(ctx, e.path);
    } else await writeFileAtomic(e.path, await readFile(join(dir, e.backup)));

    if (e.previouslyManaged === null) delete state.managed[e.path];
    else state.managed[e.path] = e.previouslyManaged;
    result.restored.push(e.path);
  }

  await writeState(ctx, state);
  manifest.undoneAt = new Date().toISOString();
  await writeFileAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), 0o600);
  return result;
}

export async function history(ctx: PathContext): Promise<ApplyManifest[]> {
  const out: ApplyManifest[] = [];
  for (const id of await listBackupIds(ctx)) {
    try {
      out.push(await readManifest(ctx, id));
    } catch {
      // Incomplete or foreign folder: ignore.
    }
  }
  return out;
}
