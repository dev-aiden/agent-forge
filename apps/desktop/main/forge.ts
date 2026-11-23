// IPC for app-managed items (agents, skills, global rule, MCP servers):
// store, import, preview, apply, undo, history.
//
// The renderer never sends paths or file contents to write. It asks for a
// preview, gets back a masked copy with an id, and can only apply a preview
// the main process made. Secrets in MCP config never reach the renderer.
import { utilityProcess, type IpcMainInvokeEvent, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { maskManagedMcp, type ManagedAgent, type ManagedMcpServer, type ManagedRule, type ManagedSkill } from "@kitroom/model";
import {
  apply,
  ConflictError,
  deleteAgent,
  deleteMcpServer,
  deleteSkill,
  displayChangeSet,
  history,
  importAgents,
  importMcp,
  importRule,
  importSkills,
  listAgents,
  listSkills,
  preview,
  readManagedMcp,
  readManagedRule,
  saveAgent,
  saveManagedRule,
  saveMcpServer,
  saveSkill,
  undo,
  unmanageMcp,
  unmanageRule,
  type ChangeSet,
  type ClaudeCliRunner,
  type PathContext,
  type PipelineRunners,
  type WorkerRunner,
} from "@kitroom/adapters";
import { IPC, type ApplyResult, type WriteScope } from "../shared/api";
import { cliEnv, findCli } from "./shell-env";

const here = dirname(fileURLToPath(import.meta.url));
const WORKER = join(here, "rulesync-worker.js");
const PREVIEW_TTL_MS = 10 * 60_000;
const CLI_TIMEOUT_MS = 60_000;

/** Runs rulesync in an Electron utility process (a separate Node process). */
const utilityRunner: WorkerRunner = ({ env, cwd }) =>
  new Promise((resolve, reject) => {
    const child = utilityProcess.fork(WORKER, [], { env, cwd, stdio: "pipe", serviceName: "Kitroom rulesync" });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`rulesync worker failed (exit ${code}): ${stderr.trim().slice(-500)}`)),
    );
  });

/** Runs the official Claude Code CLI found on PATH, or null if it is not installed. */
async function claudeRunner(): Promise<ClaudeCliRunner | null> {
  const binary = await findCli("claude");
  if (!binary) return null;
  const env = await cliEnv();
  return (args, stdin) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        env,
        cwd: homedir(),
        stdio: ["pipe", "ignore", "pipe"],
        // npm installs a .cmd shim on Windows.
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(binary),
        windowsHide: true,
      });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude ${args.slice(0, 2).join(" ")} timed out`));
      }, CLI_TIMEOUT_MS);
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        // Command name only: stdin may hold secrets and is never echoed.
        else reject(new Error(`claude ${args.slice(0, 3).join(" ")} failed (exit ${code}): ${stderr.trim().slice(-300)}`));
      });
      child.stdin.end(stdin ?? "");
    });
}

async function runners(): Promise<PipelineRunners> {
  // Claude Code refuses `mcp add-json -` (stdin) when run from inside a Claude Code
  // session, because its own permission prompt could not be shown. Respect that:
  // do not try, and tell the user to launch Kitroom normally.
  if (process.env.CLAUDECODE) return { worker: utilityRunner, claude: null, claudeUnavailable: "inside-session" };
  const claude = await claudeRunner();
  return { worker: utilityRunner, claude, claudeUnavailable: claude ? undefined : "not-found" };
}

/**
 * Where managed items are written. The renderer only chooses "global" or
 * "project"; the project folder is the one the main process is showing.
 */
let writeScope: WriteScope = "global";
let currentProject: () => string | null = () => null;

function ctx(): PathContext {
  if (writeScope === "global") return { home: homedir(), project: "", env: process.env };
  const project = currentProject();
  if (!project) throw new Error("Choose a project first.");
  return { home: homedir(), project, env: process.env };
}

/** Previews made by the main process, by id (unmasked), with the scope they were made for. */
const previews = new Map<string, { set: ChangeSet; ctx: PathContext; at: number }>();

export function registerForgeIpc(trusted: (event: IpcMainInvokeEvent) => boolean, project: () => string | null): void {
  currentProject = project;
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R>) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error("untrusted sender");
      return fn(...(args as A));
    });

  handle(IPC.setWriteScope, async (scope: unknown) => {
    if (scope !== "global" && scope !== "project") throw new Error("unknown scope");
    if (scope === "project" && !currentProject()) throw new Error("Choose a project first.");
    writeScope = scope;
    return writeScope;
  });

  handle(IPC.listAgents, () => listAgents(ctx()));
  handle(IPC.importAgents, () => importAgents(ctx()));
  handle(IPC.saveAgent, (agent: ManagedAgent, previousName?: string) => saveAgent(ctx(), agent, previousName));
  handle(IPC.deleteAgent, (name: string) => deleteAgent(ctx(), name));

  handle(IPC.listSkills, () => listSkills(ctx()));
  handle(IPC.importSkills, () => importSkills(ctx()));
  handle(IPC.saveSkill, (skill: ManagedSkill, previousName?: string) => saveSkill(ctx(), skill, previousName));
  handle(IPC.deleteSkill, (name: string) => deleteSkill(ctx(), name));

  handle(IPC.getRule, () => readManagedRule(ctx()));
  handle(IPC.saveRule, (rule: ManagedRule) => saveManagedRule(ctx(), rule));
  handle(IPC.importRule, () => importRule(ctx()));
  handle(IPC.unmanageRule, () => unmanageRule(ctx()));

  // MCP values are masked on the way out; saveMcpServer restores masked values on the way in.
  handle(IPC.listMcp, async () => {
    const list = await readManagedMcp(ctx());
    return list === null ? null : list.map(maskManagedMcp);
  });
  handle(IPC.saveMcp, async (server: ManagedMcpServer, previousName?: string) =>
    maskManagedMcp(await saveMcpServer(ctx(), server, previousName)),
  );
  handle(IPC.deleteMcp, (name: string) => deleteMcpServer(ctx(), name));
  handle(IPC.importMcp, () => importMcp(ctx()));
  handle(IPC.unmanageMcp, () => unmanageMcp(ctx()));

  handle(IPC.previewApply, async () => {
    const c = ctx();
    const set = await preview(c, await runners());
    const now = Date.now();
    for (const [id, p] of previews) if (now - p.at > PREVIEW_TTL_MS) previews.delete(id);
    previews.set(set.id, { set, ctx: c, at: now });
    return displayChangeSet(set);
  });

  handle(IPC.apply, async (id: string): Promise<ApplyResult> => {
    const entry = previews.get(id);
    if (!entry) return { ok: false, expired: true, error: "This preview expired. Preview again." };
    previews.delete(id);
    try {
      // Applies to the scope the preview was made for, even if the UI switched since.
      return { ok: true, manifest: summary(await apply(entry.ctx, entry.set, await runners())) };
    } catch (e) {
      if (e instanceof ConflictError) return { ok: false, error: e.message, conflicts: e.paths };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle(IPC.undo, async (id: string) => undo(ctx(), id, await runners()));

  handle(IPC.history, async () => (await history(ctx())).map(summary));
}

/** Manifests hold MCP definitions (with secrets): only send what the UI needs. */
function summary(m: import("@kitroom/adapters").ApplyManifest) {
  return {
    id: m.id,
    createdAt: m.createdAt,
    undoneAt: m.undoneAt,
    fileCount: m.entries.length,
    commandCount: m.commands?.length ?? 0,
  };
}

/**
 * Smoke check for packaged builds: runs a real preview (rulesync worker in a
 * utility process) against a temporary home. Touches nothing outside a temp dir.
 */
export async function smokeCheckWorker(): Promise<void> {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "kitroom-smoke-"));
  try {
    const home = join(root, "home");
    const smokeCtx: PathContext = { home, project: "", env: { KITROOM_HOME: join(root, "forge") } };
    await saveAgent(smokeCtx, { name: "smoke", description: "Smoke test", body: "Hi", targets: ["claude", "codex"] });
    const set = await preview(smokeCtx, { worker: utilityRunner, claude: null });
    const creates = set.changes.filter((c) => c.action === "create").length;
    if (creates !== 2) throw new Error(`expected 2 planned files, got ${creates}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
