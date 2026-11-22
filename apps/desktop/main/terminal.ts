// Terminal sessions: runs the official CLI binaries in a pseudo-terminal (node-pty).
// The app never talks to the AI itself and never touches CLI login/auth: it only
// starts the CLI the user already installed, exactly as a terminal would.
//
// The renderer can only ask for a known tool or the user's shell — never an
// arbitrary command line.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { scan } from "@agent-forge/adapters";
import { TOOL_IDS, type ToolId } from "@agent-forge/model";
import type { IPty } from "node-pty";
import { IPC, type LaunchTarget, type TerminalSession } from "../shared/api";
import { cliEnv, resolvedPath } from "./shell-env";

// Loaded lazily so a broken native module cannot prevent the app from starting.
type NodePty = typeof import("node-pty");
let nodePty: NodePty | null = null;
async function loadPty(): Promise<NodePty> {
  if (!nodePty) {
    const mod = (await import("node-pty")) as NodePty & { default?: NodePty };
    nodePty = mod.default ?? mod;
  }
  return nodePty;
}

interface Session {
  pty: IPty;
  owner: WebContents;
}

const sessions = new Map<number, Session>();
let nextId = 1;

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: process.env.ComSpec || "cmd.exe", args: [] };
  return { file: process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), args: ["-l"] };
}

/** Resolves what to run for a launch target. Tool binaries come from a PATH lookup only. */
async function commandFor(target: LaunchTarget): Promise<{ file: string; args: string[] }> {
  if (target === "shell") return defaultShell();
  if (!TOOL_IDS.includes(target)) throw new Error("unknown tool");
  const path = await resolvedPath();
  const result = await scan({ home: homedir(), project: "", env: { PATH: path, PATHEXT: process.env.PATHEXT } });
  const binary = result.tools.find((t) => t.id === target)?.binary;
  if (!binary) throw new Error(`${target} CLI was not found on PATH`);
  // npm installs .cmd shims on Windows; ConPTY needs a real executable.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/c", binary] };
  }
  return { file: binary, args: [] };
}

export async function spawnSession(
  owner: WebContents,
  target: LaunchTarget,
  cwd: string | null,
  cols: number,
  rows: number,
): Promise<TerminalSession> {
  const pty = await loadPty();
  const { file, args } = await commandFor(target);
  const dir = cwd && existsSync(cwd) ? cwd : homedir();
  const env = await cliEnv();
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  delete env.ELECTRON_RUN_AS_NODE;

  const p = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: Math.max(2, Math.floor(cols) || 80),
    rows: Math.max(2, Math.floor(rows) || 24),
    cwd: dir,
    env,
  });
  const id = nextId++;
  sessions.set(id, { pty: p, owner });

  p.onData((data) => {
    if (!owner.isDestroyed()) owner.send(IPC.termData, id, data);
  });
  p.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!owner.isDestroyed()) owner.send(IPC.termExit, id, exitCode);
  });

  return { id, target, cwd: dir, command: [file, ...args].join(" ") };
}

function owned(event: IpcMainInvokeEvent | Electron.IpcMainEvent, id: unknown): Session | null {
  const s = typeof id === "number" ? sessions.get(id) : undefined;
  return s && s.owner === event.sender ? s : null;
}

export function killAllSessions(): void {
  for (const s of sessions.values()) {
    try {
      s.pty.kill();
    } catch {
      // already gone
    }
  }
  sessions.clear();
}

export function registerTerminalIpc(
  trusted: (event: IpcMainInvokeEvent | Electron.IpcMainEvent) => boolean,
  currentProject: () => string | null,
): void {
  ipcMain.handle(IPC.termSpawn, (event, target: unknown, cols: unknown, rows: unknown) => {
    if (!trusted(event)) throw new Error("untrusted sender");
    if (target !== "shell" && !TOOL_IDS.includes(target as ToolId)) throw new Error("unknown launch target");
    return spawnSession(event.sender, target as LaunchTarget, currentProject(), Number(cols), Number(rows));
  });
  ipcMain.on(IPC.termWrite, (event, id: unknown, data: unknown) => {
    if (!trusted(event) || typeof data !== "string") return;
    owned(event, id)?.pty.write(data);
  });
  ipcMain.on(IPC.termResize, (event, id: unknown, cols: unknown, rows: unknown) => {
    if (!trusted(event)) return;
    const c = Math.floor(Number(cols));
    const r = Math.floor(Number(rows));
    if (c > 1 && r > 1 && c < 1000 && r < 1000) owned(event, id)?.pty.resize(c, r);
  });
  ipcMain.on(IPC.termKill, (event, id: unknown) => {
    if (!trusted(event)) return;
    const s = owned(event, id);
    if (s) {
      s.pty.kill();
      sessions.delete(id as number);
    }
  });
}

/**
 * Smoke check for packaged builds: proves the native pty module loads and runs
 * a console program. (Electron's own executable is a GUI app on Windows, so its
 * output never reaches the pseudo-console; use the system shell instead.)
 */
export async function smokeCheckPty(): Promise<void> {
  const pty = await loadPty();
  const [file, args] =
    process.platform === "win32"
      ? [process.env.ComSpec || "cmd.exe", ["/d", "/c", "echo PTY_OK"]]
      : ["/bin/sh", ["-c", "printf PTY_OK"]];
  await new Promise<void>((resolve, reject) => {
    const p = pty.spawn(file, args, { cols: 80, rows: 24, cwd: homedir(), env: process.env as Record<string, string> });
    let out = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(`pty timeout, output: ${JSON.stringify(out.slice(-200))}`));
    }, 20_000);
    p.onData((d) => (out += d));
    p.onExit(() => {
      clearTimeout(timer);
      // ConPTY can report exit before the last output is delivered.
      setTimeout(() => {
        if (out.includes("PTY_OK")) resolve();
        else reject(new Error(`pty output missing marker: ${JSON.stringify(out.slice(-200))}`));
      }, 500);
    });
  });
}
