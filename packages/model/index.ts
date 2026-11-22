// Common data model for rules, agents, skills and MCP servers across all tools.
//
// Field names follow the rulesync source format (name, description, targets,
// root, globs) so app-managed items can later be exported to a `.rulesync/`
// tree and handed to rulesync for generation.

export type ToolId = "claude" | "codex" | "copilot" | "antigravity";

export const TOOL_IDS: readonly ToolId[] = ["claude", "codex", "copilot", "antigravity"];

/** rulesync target name for each tool. */
export const RULESYNC_TARGET: Record<ToolId, string> = {
  claude: "claudecode",
  codex: "codexcli",
  copilot: "copilotcli",
  antigravity: "antigravity-cli",
};

/**
 * global  — user-wide (~/...)
 * project — checked into a project directory
 * local   — project-specific but private to this user (e.g. CLAUDE.local.md,
 *           per-project MCP servers stored in ~/.claude.json)
 */
export type Scope = "global" | "project" | "local";

export type SourceFormat = "markdown" | "json" | "toml";

/** Where an item was read from. */
export interface Source {
  tool: ToolId;
  scope: Scope;
  /** Absolute path of the file holding the item. */
  path: string;
  format: SourceFormat;
  /** False when the location is not confirmed by the tool's docs yet. */
  verified: boolean;
}

interface ItemBase {
  /** Stable id: `<tool>:<path>` plus `#<name>` for items inside a shared file. */
  id: string;
  name: string;
  description?: string;
  source: Source;
}

export interface Rule extends ItemBase {
  kind: "rule";
  body: string;
  /** True for the top-level instruction file (CLAUDE.md, AGENTS.md...). */
  root: boolean;
  /** File patterns the rule applies to, when the tool supports scoping. */
  globs?: string[];
}

export interface Agent extends ItemBase {
  kind: "agent";
  /** System prompt / instructions. */
  body: string;
  model?: string;
  tools?: string[];
  /** Tool-specific fields kept as-is so nothing is lost on round-trip. */
  extra: Record<string, unknown>;
}

export interface Skill extends ItemBase {
  kind: "skill";
  /** SKILL.md body (without frontmatter). */
  body: string;
  /** Other files bundled with the skill, relative to the skill directory. */
  files: string[];
  extra: Record<string, unknown>;
}

export type McpTransport = "stdio" | "http" | "sse";

export interface McpServer extends ItemBase {
  kind: "mcp";
  transport: McpTransport;
  command?: string;
  args?: string[];
  /** May contain secrets. Mask before sending anywhere (see maskMcpServer). */
  env?: Record<string, string>;
  url?: string;
  /** May contain secrets. Mask before sending anywhere (see maskMcpServer). */
  headers?: Record<string, string>;
  enabled: boolean;
  extra: Record<string, unknown>;
}

export type Item = Rule | Agent | Skill | McpServer;

/** A problem found while reading (unparseable file, unexpected shape...). */
export interface ReadIssue {
  path: string;
  message: string;
}

/** Everything read from one tool. */
export interface ToolConfig {
  tool: ToolId;
  rules: Rule[];
  agents: Agent[];
  skills: Skill[];
  mcpServers: McpServer[];
  issues: ReadIssue[];
}

export const MASK = "••••";

const SECRET_NAME = /(key|token|secret|password|passwd|auth|credential|bearer|cookie|session)/i;

export function maskArgs(args?: string[]): string[] | undefined {
  if (!args) return undefined;
  return args.map((arg, i) => {
    // --api-key=xxx
    const eq = arg.match(/^(-{1,2}[^=]+)=(.*)$/);
    if (eq && SECRET_NAME.test(eq[1])) return `${eq[1]}=${MASK}`;
    // --api-key xxx
    const prev = args[i - 1];
    if (prev && /^-{1,2}[^=]+$/.test(prev) && SECRET_NAME.test(prev) && !arg.startsWith("-")) return MASK;
    return arg;
  });
}

export function maskUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = u.username ? MASK : "";
      u.password = u.password ? MASK : "";
    }
    for (const k of [...u.searchParams.keys()]) u.searchParams.set(k, MASK);
    return u.toString().replaceAll(encodeURIComponent(MASK), MASK);
  } catch {
    return MASK;
  }
}

/**
 * Hides values that may be secrets, keeping structure and key names:
 * env / header values, secret-looking CLI args, URL credentials and query
 * values, and string values in tool-specific extra fields.
 */
/** Numbers and booleans are shown; anything else (strings, tables) may be secret. */
function maskExtra(extra: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === "number" || typeof v === "boolean" ? v : MASK]));
}

export function maskMcpServer(server: McpServer): McpServer {
  const maskRecord = (r?: Record<string, string>) =>
    r ? Object.fromEntries(Object.keys(r).map((k) => [k, MASK])) : undefined;
  const extra = maskExtra(server.extra);
  return {
    ...server,
    args: maskArgs(server.args),
    env: maskRecord(server.env),
    headers: maskRecord(server.headers),
    url: maskUrl(server.url),
    extra,
  };
}

export function maskToolConfig(config: ToolConfig): ToolConfig {
  return { ...config, mcpServers: config.mcpServers.map(maskMcpServer) };
}

// ---------------------------------------------------------------------------
// App-managed items (stored in ~/.agent-forge/source as a rulesync source tree)

/** An agent created in Agent Forge and applied to the selected tools. */
export interface ManagedAgent {
  /** File-safe identifier: letters, digits, `-` and `_`. Also the output file name. */
  name: string;
  description: string;
  /** System prompt / instructions. */
  body: string;
  /** Claude Code model alias (e.g. "sonnet") or full model id. */
  model?: string;
  /** Claude Code tool allowlist. Empty / undefined = inherit all tools. */
  tools?: string[];
  /** Tools to apply this agent to. */
  targets: ToolId[];
}

export const MANAGED_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Tools Agent Forge can write agents to so far. */
export const WRITABLE_AGENT_TOOLS: readonly ToolId[] = ["claude", "codex"];

/** A skill created in Agent Forge (SKILL.md only for now). */
export interface ManagedSkill {
  /** File-safe identifier; also the skill folder name. */
  name: string;
  /** When the tool should use this skill. */
  description: string;
  /** SKILL.md body. */
  body: string;
  targets: ToolId[];
}

/** Names that would collide with folders managed by the tools themselves. */
export const RESERVED_SKILL_NAMES: readonly string[] = ["synced"];

export type ManagedKind = "agent" | "skill";

/** An MCP server managed by Agent Forge (global scope). */
export interface ManagedMcpServer {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  /** Secret values. Never sent to the renderer unmasked. */
  env?: Record<string, string>;
  url?: string;
  /** Secret values. Never sent to the renderer unmasked. */
  headers?: Record<string, string>;
  targets: ToolId[];
  /**
   * Codex-only fields kept as they were in config.toml (startup_timeout_sec,
   * enabled = false, cwd, ...). Not editable in the app; may hold secrets.
   */
  codexExtra?: Record<string, unknown>;
}

/** The global top-level instructions (CLAUDE.md / AGENTS.md) managed by Agent Forge. */
export interface ManagedRule {
  body: string;
  targets: ToolId[];
}

/** Masks a managed MCP server for display (same rules as maskMcpServer). */
export function maskManagedMcp(server: ManagedMcpServer): ManagedMcpServer {
  const maskRecord = (r?: Record<string, string>) =>
    r ? Object.fromEntries(Object.keys(r).map((k) => [k, MASK])) : undefined;
  return {
    ...server,
    args: maskArgs(server.args),
    env: maskRecord(server.env),
    headers: maskRecord(server.headers),
    url: maskUrl(server.url),
    codexExtra: server.codexExtra && maskExtra(server.codexExtra),
  };
}
