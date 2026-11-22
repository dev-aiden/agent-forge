// IPC for app-managed agents: store, preview, apply, undo, history.
//
// The renderer never sends paths or file contents to write. It asks for a
// preview, gets back an id, and can only apply a preview the main process made.
import { utilityProcess, type IpcMainInvokeEvent, ipcMain } from "electron";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManagedAgent, ManagedSkill } from "@agent-forge/model";
import {
  apply,
  ConflictError,
  deleteAgent,
  deleteSkill,
  history,
  listAgents,
  listSkills,
  preview,
  saveAgent,
  saveSkill,
  undo,
  type ChangeSet,
  type PathContext,
  type WorkerRunner,
} from "@agent-forge/adapters";
import { IPC, type ApplyResult } from "../shared/api";

const here = dirname(fileURLToPath(import.meta.url));
const WORKER = join(here, "rulesync-worker.js");
const PREVIEW_TTL_MS = 10 * 60_000;

/** Runs rulesync in an Electron utility process (a separate Node process). */
const utilityRunner: WorkerRunner = ({ env, cwd }) =>
  new Promise((resolve, reject) => {
    const child = utilityProcess.fork(WORKER, [], { env, cwd, stdio: "pipe", serviceName: "Agent Forge rulesync" });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`rulesync worker failed (exit ${code}): ${stderr.trim().slice(-500)}`)),
    );
  });

function ctx(): PathContext {
  // Global scope only for now: no project.
  return { home: homedir(), project: "", env: process.env };
}

/** Previews made by the main process, by id. Apply only accepts these. */
const previews = new Map<string, { set: ChangeSet; at: number }>();

export function registerForgeIpc(trusted: (event: IpcMainInvokeEvent) => boolean): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R>) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      return fn(...(args as A));
    });

  handle(IPC.listAgents, () => listAgents(ctx()));

  handle(IPC.saveAgent, (agent: ManagedAgent, previousName?: string) => saveAgent(ctx(), agent, previousName));

  handle(IPC.deleteAgent, (name: string) => deleteAgent(ctx(), name));

  handle(IPC.listSkills, () => listSkills(ctx()));

  handle(IPC.saveSkill, (skill: ManagedSkill, previousName?: string) => saveSkill(ctx(), skill, previousName));

  handle(IPC.deleteSkill, (name: string) => deleteSkill(ctx(), name));

  handle(IPC.previewApply, async () => {
    const set = await preview(ctx(), utilityRunner);
    const now = Date.now();
    for (const [id, p] of previews) if (now - p.at > PREVIEW_TTL_MS) previews.delete(id);
    previews.set(set.id, { set, at: now });
    return set;
  });

  handle(IPC.apply, async (id: string): Promise<ApplyResult> => {
    const entry = previews.get(id);
    if (!entry) return { ok: false, error: "This preview expired. Preview again." };
    previews.delete(id);
    try {
      return { ok: true, manifest: await apply(ctx(), entry.set) };
    } catch (e) {
      if (e instanceof ConflictError) return { ok: false, error: e.message, conflicts: e.paths };
      throw e;
    }
  });

  handle(IPC.undo, (id: string) => undo(ctx(), id));

  handle(IPC.history, () => history(ctx()));
}

/**
 * Smoke check for packaged builds: runs a real preview (rulesync worker in a
 * utility process) against a temporary home. Touches nothing outside a temp dir.
 */
export async function smokeCheckWorker(): Promise<void> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "agent-forge-smoke-"));
  try {
    const home = join(root, "home");
    const smokeCtx: PathContext = { home, project: "", env: { AGENT_FORGE_HOME: join(root, "forge") } };
    await saveAgent(smokeCtx, { name: "smoke", description: "Smoke test", body: "Hi", targets: ["claude", "codex"] });
    const set = await preview(smokeCtx, utilityRunner);
    const creates = set.changes.filter((c) => c.action === "create").length;
    if (creates !== 2) throw new Error(`expected 2 planned files, got ${creates}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
