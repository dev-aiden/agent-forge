// Types shared by main, preload and renderer. Keep this file free of runtime imports.
import type { ApplyManifest, ChangeSet, UndoResult } from "@agent-forge/adapters";
import type { ManagedAgent, ManagedSkill, ToolConfig, ToolId } from "@agent-forge/model";

export type { ApplyManifest, Change, ChangeSet, UndoResult } from "@agent-forge/adapters";

export type ApplyResult =
  | { ok: true; manifest: ApplyManifest }
  | { ok: false; error: string; conflicts?: string[] };

export interface AppInfo {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  electron: string;
  node: string;
  chrome: string;
  /** Project passed with `--project <dir>` on launch, if any. */
  initialProject: string | null;
}

export type Language = "system" | "en" | "ko";

export interface AppSettings {
  language: Language;
  /** Tools hidden everywhere in the app (overview, terminal). */
  disabledTools: ToolId[];
}

/** What a terminal tab runs: an official CLI found on PATH, or the user's shell. */
export type LaunchTarget = ToolId | "shell";

export interface TerminalSession {
  id: number;
  target: LaunchTarget;
  cwd: string;
  /** The command line that was started (for display). */
  command: string;
}

export interface ToolOverview {
  id: ToolId;
  label: string;
  /** Path of the CLI binary found on PATH (never executed). */
  binary: string | null;
  /** Binary or any config file found. Undetected tools are hidden in the UI. */
  detected: boolean;
  /** A read adapter exists for this tool. */
  supported: boolean;
  /** Read result with MCP secrets masked. Null when undetected or unsupported. */
  config: ToolConfig | null;
}

export interface Overview {
  home: string;
  project: string | null;
  tools: ToolOverview[];
  /** ISO timestamp. */
  readAt: string;
}

/** The only API the renderer can reach. Exposed by preload as `window.agentForge`. */
export interface AgentForgeApi {
  getInfo(): Promise<AppInfo>;
  /** Read-only snapshot of every tool's config. `project` null = global scope only. */
  getOverview(project: string | null): Promise<Overview>;
  /** Opens a folder picker. Resolves to the chosen directory or null. */
  pickProject(): Promise<string | null>;
  /**
   * Subscribes to config changes on disk for the project of the last getOverview call.
   * Fires only when the overview actually changed. Returns an unsubscribe function.
   */
  onOverviewChanged(callback: (overview: Overview) => void): () => void;

  // App-managed agents (global scope). Writing goes preview → apply(previewId) → undo.
  listAgents(): Promise<ManagedAgent[]>;
  saveAgent(agent: ManagedAgent, previousName?: string): Promise<ManagedAgent>;
  deleteAgent(name: string): Promise<void>;
  listSkills(): Promise<ManagedSkill[]>;
  saveSkill(skill: ManagedSkill, previousName?: string): Promise<ManagedSkill>;
  deleteSkill(name: string): Promise<void>;
  /** Computes changes without touching tool config. */
  previewApply(): Promise<ChangeSet>;
  /** Applies a preview made by the main process (by id only). */
  apply(previewId: string): Promise<ApplyResult>;
  undo(applyId: string): Promise<UndoResult>;
  history(): Promise<ApplyManifest[]>;


  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;

  // Terminal tabs (official CLIs in a pseudo-terminal).
  termSpawn(target: LaunchTarget, cols: number, rows: number): Promise<TerminalSession>;
  termWrite(id: number, data: string): void;
  termResize(id: number, cols: number, rows: number): void;
  termKill(id: number): void;
  onTermData(callback: (id: number, data: string) => void): () => void;
  onTermExit(callback: (id: number, exitCode: number) => void): () => void;

  /** Called once the first screen has rendered (used by --smoke-test). Pass an error message on failure. */
  notifyReady(error?: string): void;
}

export const IPC = {
  getInfo: "app:get-info",
  getOverview: "config:get-overview",
  pickProject: "dialog:pick-project",
  overviewChanged: "config:overview-changed",
  rendererReady: "app:renderer-ready",
  listAgents: "forge:list-agents",
  saveAgent: "forge:save-agent",
  deleteAgent: "forge:delete-agent",
  listSkills: "forge:list-skills",
  saveSkill: "forge:save-skill",
  deleteSkill: "forge:delete-skill",
  previewApply: "forge:preview",
  apply: "forge:apply",
  undo: "forge:undo",
  history: "forge:history",
  getSettings: "settings:get",
  saveSettings: "settings:save",
  termSpawn: "term:spawn",
  termWrite: "term:write",
  termResize: "term:resize",
  termKill: "term:kill",
  termData: "term:data",
  termExit: "term:exit",
} as const;
