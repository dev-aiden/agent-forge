// Types shared by main, preload and renderer. Keep this file free of runtime imports.
import type { ChangeSet, CommandTool, ItemImportResult, LegacyCommand, McpImportResult, MoveCommandResult, PermissionsImportResult, RuleImportResult, UndoResult } from "@kitroom/adapters";
import type { ManagedAgent, ManagedMcpServer, ManagedPermissions, ManagedRule, ManagedSkill, ToolConfig, ToolId } from "@kitroom/model";

export type { Change, ChangeSet, CommandBlockReason, CommandChange, CommandTool, ClaudeMcpDef, ImportSkipReason, LegacyCommand, MoveCommandResult, PermissionSkipReason, PermissionsImportResult, ItemImportResult, McpImportResult, RuleImportResult, UndoResult, Warning } from "@kitroom/adapters";

/** What the renderer sees of an apply (manifests hold secrets and stay in the main process). */
export interface ApplySummary {
  id: string;
  createdAt: string;
  undoneAt?: string;
  fileCount: number;
  commandCount: number;
}

export type ApplyResult =
  | { ok: true; manifest: ApplySummary }
  | { ok: false; error: string; conflicts?: string[]; expired?: boolean };

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

/** Where managed items are written: the user's home (global) or the selected project. */
export type WriteScope = "global" | "project";

export type Theme = "system" | "light" | "dark";

export const TERMINAL_FONT_SIZE = { min: 9, max: 28, default: 13 } as const;

/** GitHub repository whose published releases the update check looks at. */
export const RELEASES_REPO = "dev-aiden/kitroom";

/** A newer release than the running app. */
export interface UpdateInfo {
  version: string;
  url: string;
}

export interface AppSettings {
  language: Language;
  theme: Theme;
  /** Terminal tab font size in px. */
  terminalFontSize: number;
  /** Tools hidden everywhere in the app (overview, terminal). */
  disabledTools: ToolId[];
  /** Ask GitHub for a newer release on launch. */
  checkUpdates: boolean;
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

/** The only API the renderer can reach. Exposed by preload as `window.kitroom`. */
export interface KitroomApi {
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
  /** Starts managing the agents the tools already have (in the current write scope). */
  importAgents(): Promise<ItemImportResult>;
  saveAgent(agent: ManagedAgent, previousName?: string): Promise<ManagedAgent>;
  deleteAgent(name: string): Promise<void>;
  listSkills(): Promise<ManagedSkill[]>;
  importSkills(): Promise<ItemImportResult>;
  saveSkill(skill: ManagedSkill, previousName?: string): Promise<ManagedSkill>;
  deleteSkill(name: string): Promise<void>;
  /** Custom commands (Claude Code) and prompts (Codex) of the current scope. */
  listCommands(): Promise<LegacyCommand[]>;
  /** Makes a skill from a command. `removeOriginal` queues the file for deletion by the next apply. */
  moveCommand(tool: CommandTool, name: string, removeOriginal: boolean): Promise<MoveCommandResult>;
  /** Global rule managed by Kitroom, or null if not managed. */
  getRule(): Promise<ManagedRule | null>;
  saveRule(rule: ManagedRule): Promise<ManagedRule>;
  /** Starts managing the global rule with the current CLAUDE.md / AGENTS.md. */
  importRule(): Promise<RuleImportResult>;
  /** Stops managing the global rule (tool files are left as they are). */
  unmanageRule(): Promise<void>;

  /** Managed MCP servers with secret values masked, or null if MCP is not managed. */
  listMcp(): Promise<ManagedMcpServer[] | null>;
  /** Masked values sent back unchanged keep the stored secret. */
  saveMcp(server: ManagedMcpServer, previousName?: string): Promise<ManagedMcpServer>;
  deleteMcp(name: string): Promise<void>;
  /** Adds servers configured in Claude Code / Codex that are not managed yet. */
  importMcp(): Promise<McpImportResult>;
  unmanageMcp(): Promise<void>;

  /** Claude Code permission rules managed by Kitroom (current scope), or null if not managed. */
  getPermissions(): Promise<ManagedPermissions | null>;
  savePermissions(permissions: ManagedPermissions): Promise<ManagedPermissions>;
  /** Starts managing the allow / ask / deny lists of the scope's Claude Code settings.json. */
  importPermissions(): Promise<PermissionsImportResult>;
  /** Stops managing permissions (settings.json is left as it is). */
  unmanagePermissions(): Promise<void>;

  /** Computes changes without touching tool config. Secrets are masked. */
  previewApply(): Promise<ChangeSet>;
  /** Applies a preview made by the main process (by id only). */
  apply(previewId: string): Promise<ApplyResult>;
  undo(applyId: string): Promise<UndoResult>;
  history(): Promise<ApplySummary[]>;


  /** Chooses where agents, skills, rules and MCP are read from and written to. */
  setWriteScope(scope: WriteScope): Promise<WriteScope>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  /** Newer published release, or null. Only asks GitHub when the setting is on. */
  checkForUpdate(): Promise<UpdateInfo | null>;

  // Terminal tabs (official CLIs in a pseudo-terminal).
  termSpawn(target: LaunchTarget, cols: number, rows: number): Promise<TerminalSession>;
  termWrite(id: number, data: string): void;
  termResize(id: number, cols: number, rows: number): void;
  termKill(id: number): void;
  onTermData(callback: (id: number, data: string) => void): () => void;
  onTermExit(callback: (id: number, exitCode: number) => void): () => void;
  /** Opens an http(s) link from terminal output in the default browser. */
  openExternal(url: string): void;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): void;

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
  importAgents: "forge:import-agents",
  saveAgent: "forge:save-agent",
  deleteAgent: "forge:delete-agent",
  listSkills: "forge:list-skills",
  importSkills: "forge:import-skills",
  saveSkill: "forge:save-skill",
  deleteSkill: "forge:delete-skill",
  listCommands: "forge:list-commands",
  moveCommand: "forge:move-command",
  getRule: "forge:get-rule",
  saveRule: "forge:save-rule",
  importRule: "forge:import-rule",
  unmanageRule: "forge:unmanage-rule",
  listMcp: "forge:list-mcp",
  saveMcp: "forge:save-mcp",
  deleteMcp: "forge:delete-mcp",
  importMcp: "forge:import-mcp",
  unmanageMcp: "forge:unmanage-mcp",
  getPermissions: "forge:get-permissions",
  savePermissions: "forge:save-permissions",
  importPermissions: "forge:import-permissions",
  unmanagePermissions: "forge:unmanage-permissions",
  previewApply: "forge:preview",
  apply: "forge:apply",
  undo: "forge:undo",
  history: "forge:history",
  getSettings: "settings:get",
  saveSettings: "settings:save",
  checkForUpdate: "app:check-update",
  setWriteScope: "forge:set-write-scope",
  termSpawn: "term:spawn",
  termWrite: "term:write",
  termResize: "term:resize",
  termKill: "term:kill",
  termData: "term:data",
  termExit: "term:exit",
  openExternal: "shell:open-external",
  clipboardRead: "clipboard:read",
  clipboardWrite: "clipboard:write",
} as const;
