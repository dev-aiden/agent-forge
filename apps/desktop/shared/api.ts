// Types shared by main, preload and renderer. Keep this file free of runtime imports.
import type { ToolConfig, ToolId } from "@agent-forge/model";

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
  /** Called once the first screen has rendered (used by --smoke-test). Pass an error message on failure. */
  notifyReady(error?: string): void;
}

export const IPC = {
  getInfo: "app:get-info",
  getOverview: "config:get-overview",
  pickProject: "dialog:pick-project",
  rendererReady: "app:renderer-ready",
} as const;
