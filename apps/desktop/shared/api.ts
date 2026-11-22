// Types shared by main, preload and renderer. Keep this file free of runtime imports.
import type { ApplyManifest, ChangeSet, UndoResult } from "@agent-forge/adapters";
import type { ManagedAgent, ToolConfig, ToolId } from "@agent-forge/model";

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
  /** Computes changes without touching tool config. */
  previewApply(): Promise<ChangeSet>;
  /** Applies a preview made by the main process (by id only). */
  apply(previewId: string): Promise<ApplyResult>;
  undo(applyId: string): Promise<UndoResult>;
  history(): Promise<ApplyManifest[]>;

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
  previewApply: "forge:preview",
  apply: "forge:apply",
  undo: "forge:undo",
  history: "forge:history",
} as const;
