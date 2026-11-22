// Preview → apply → undo for app-managed items.
//
// 1. preview: rulesync generates into a throw-away staging home (separate process).
//    Staged files are compared with the real ones. Nothing real is touched.
// 2. apply:   re-checks that real files did not change since the preview, backs up
//    originals to ~/.agent-forge/backups/<id>/, then writes atomically.
// 3. undo:    restores the backup. Files edited by the user after the apply are kept.
//
// All writes to tool config go through `writeChange` / `restoreChange`, and every
// path is checked against `writableRoots` first.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { RULESYNC_TARGET, WRITABLE_AGENT_TOOLS } from "@agent-forge/model";
import { claudePaths } from "../claude/paths";
import { codexPaths } from "../codex/paths";
import { isSensitive } from "../shared/read-utils";
import type { PathContext } from "../types";
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

export type ChangeAction = "create" | "modify" | "delete" | "unchanged";

export interface Change {
  /** Absolute path of the real file. */
  path: string;
  action: ChangeAction;
  before: string | null;
  after: string | null;
  /** sha256 of `before` (null = file did not exist). Checked again at apply time. */
  beforeHash: string | null;
  /** The file exists but was not written by Agent Forge. */
  unmanagedOverwrite: boolean;
}

export interface ChangeSet {
  id: string;
  createdAt: string;
  changes: Change[];
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

export interface ApplyManifest {
  id: string;
  createdAt: string;
  entries: ManifestEntry[];
  undoneAt?: string;
}

export class ConflictError extends Error {
  constructor(readonly paths: string[]) {
    super(`Files changed since the preview: ${paths.join(", ")}. Preview again.`);
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

/** Directories Agent Forge may write into. Everything else is refused. */
export function writableRoots(ctx: PathContext): string[] {
  const claude = claudePaths(ctx).global;
  const codex = codexPaths(ctx).global;
  return [claude.agentsDir, claude.skillsDir, codex.agentsDir, codex.skillsDir];
}

/** Folders inside writable roots that belong to someone else (e.g. claude.ai synced skills). */
export function protectedDirs(ctx: PathContext): string[] {
  return [claudePaths(ctx).global.syncedSkillsDir];
}

export function assertWritable(ctx: PathContext, path: string): void {
  const abs = resolve(path);
  if (abs !== path) throw new Error(`refusing non-normalized path: ${path}`);
  if (isSensitive(abs)) throw new Error(`refusing to write credential file: ${abs}`);
  if (!writableRoots(ctx).some((root) => inside(abs, root))) throw new Error(`refusing to write outside tool config folders: ${abs}`);
  if (protectedDirs(ctx).some((dir) => abs === dir || inside(abs, dir))) throw new Error(`refusing to write into a folder managed by another app: ${abs}`);
}

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

export async function preview(ctx: PathContext, runWorker: WorkerRunner): Promise<ChangeSet> {
  await ensureForgeDirs(ctx);
  const forge = forgePaths(ctx);
  const itemCount = (await listAgents(ctx)).length + (await listSkills(ctx)).length;
  const state = await readState(ctx);

  // Generate into a staging home that rulesync treats as "~".
  const stagingRoot = await mkdtemp(join(tmpdir(), "agent-forge-stage-"));
  try {
    const stagingHome = join(stagingRoot, "home");
    const work = join(stagingRoot, "work");
    await mkdir(stagingHome);
    await mkdir(work);

    let outputs: string[] = [];
    if (itemCount > 0) {
      const resultPath = join(stagingRoot, "result.json");
      const job = {
        stagingRoot,
        stagingHome,
        inputRoot: forge.source,
        targets: WRITABLE_AGENT_TOOLS.map((t) => RULESYNC_TARGET[t]),
        features: ["subagents", "skills"],
      };
      await runWorker({
        cwd: work,
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

    const changes: Change[] = [];
    const produced = new Set<string>();

    for (const rel of outputs) {
      const staged = resolve(stagingHome, rel);
      if (!inside(staged, stagingHome)) throw new Error(`rulesync produced a path outside the staging home: ${rel}`);
      const path = resolve(ctx.home, rel);
      assertWritable(ctx, path);
      produced.add(path);

      const after = await readFile(staged, "utf8");
      const before = await readOrNull(path);
      const beforeHash = before === null ? null : sha256(before);
      changes.push({
        path,
        action: before === null ? "create" : before === after ? "unchanged" : "modify",
        before,
        after,
        beforeHash,
        unmanagedOverwrite: before !== null && before !== after && state.managed[path] !== beforeHash,
      });
    }

    // Files Agent Forge wrote earlier that are no longer produced → remove them,
    // unless the user edited them since (then leave them alone).
    for (const [path, hash] of Object.entries(state.managed)) {
      if (produced.has(path)) continue;
      assertWritable(ctx, path);
      const before = await readOrNull(path);
      if (before === null || sha256(before) !== hash) continue;
      changes.push({ path, action: "delete", before, after: null, beforeHash: hash, unmanagedOverwrite: false });
    }

    changes.sort((a, b) => a.path.localeCompare(b.path));
    return { id: newApplyId(), createdAt: new Date().toISOString(), changes };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function newApplyId(): string {
  // Sortable by time, unique, file-name safe.
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// apply

export async function apply(ctx: PathContext, set: ChangeSet): Promise<ApplyManifest> {
  const pending = set.changes.filter((c) => c.action !== "unchanged");
  for (const c of pending) assertWritable(ctx, c.path);

  // Refuse if anything changed on disk since the preview.
  const conflicts: string[] = [];
  for (const c of pending) {
    const now = await readOrNull(c.path);
    if ((now === null ? null : sha256(now)) !== c.beforeHash) conflicts.push(c.path);
  }
  if (conflicts.length) throw new ConflictError(conflicts);

  const dir = join(forgePaths(ctx).backups, set.id);
  await mkdir(dir, { recursive: true });
  const state = await readState(ctx);

  // Back up everything first, then write.
  const entries: ManifestEntry[] = [];
  for (const [i, c] of pending.entries()) {
    let backup: string | null = null;
    if (c.before !== null) {
      backup = `${String(i).padStart(3, "0")}.bak`;
      await writeFileAtomic(join(dir, backup), c.before);
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
  const manifest: ApplyManifest = { id: set.id, createdAt: new Date().toISOString(), entries };
  await writeFileAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const done: Change[] = [];
  try {
    for (const c of pending) {
      if (c.action === "delete") {
        await unlink(c.path);
        await removeEmptyParents(ctx, c.path);
      } else await writeFileAtomic(c.path, c.after!);
      done.push(c);
    }
  } catch (e) {
    // Roll back what was already written.
    for (const c of done.reverse()) {
      if (c.before === null) {
        await rm(c.path, { force: true });
        await removeEmptyParents(ctx, c.path);
      } else await writeFileAtomic(c.path, c.before);
    }
    await rm(dir, { recursive: true, force: true });
    throw e;
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
  /** Files edited by the user after the apply; left as they are. */
  skipped: string[];
}

async function readManifest(ctx: PathContext, id: string): Promise<ApplyManifest> {
  if (!/^[0-9A-Za-z-]+$/.test(id)) throw new Error("invalid apply id");
  return JSON.parse(await readFile(join(forgePaths(ctx).backups, id, "manifest.json"), "utf8")) as ApplyManifest;
}

export async function undo(ctx: PathContext, id: string): Promise<UndoResult> {
  const manifest = await readManifest(ctx, id);
  if (manifest.undoneAt) throw new Error("This apply was already undone.");
  const dir = join(forgePaths(ctx).backups, id);
  const state = await readState(ctx);
  const result: UndoResult = { restored: [], skipped: [] };

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
  await writeFileAtomic(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
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
