// Shared types for adapter path definitions and the read-only scanner.
import type { Scope, ToolId } from "@agent-forge/model";

export type { Scope, ToolId };

export type Kind =
  | "rules"
  | "agents"
  | "skills"
  | "mcp"
  | "commands"
  | "hooks"
  | "settings"
  | "plugins";

export type Format = "markdown" | "json" | "toml" | "mixed";

/** How to count items inside a directory candidate. */
export type CountMode =
  | "md" // *.md files (recursive)
  | "agent-md" // *.agent.md files (recursive)
  | "skill" // direct sub-directories that contain SKILL.md
  | "skill-nested" // directories containing SKILL.md at any depth (dot-dirs skipped)
  | "toml" // *.toml files (recursive)
  | "json" // *.json files (recursive)
  | "entries"; // any direct entry

/**
 * What to extract from a structured file. Extractors only ever return
 * key names (never values), so secrets stored as values cannot leak.
 */
export type Extract =
  | { type: "mcp-json"; keys: string[] } // object keys under the first matching top-level key
  | { type: "mcp-toml" } // [mcp_servers.<name>] tables
  | { type: "claude-user-json"; project: string } // ~/.claude.json: user + per-project mcpServers
  | { type: "top-keys" } // top-level key names only
  | { type: "keys-at"; at: string }; // key names of one top-level object

export interface Candidate {
  tool: ToolId;
  kind: Kind;
  scope: Scope;
  /** Absolute path. */
  path: string;
  type: "file" | "dir";
  format: Format;
  count?: CountMode;
  extract?: Extract;
  /** Short remark, e.g. "shared with codex" or "unverified path". */
  note?: string;
}

export interface PathContext {
  home: string;
  project: string;
  env: Record<string, string | undefined>;
}

export interface ToolDefinition {
  id: ToolId;
  label: string;
  /** Executable names looked up on PATH (never executed). */
  binaries: string[];
  /** File names that hold credentials. The scanner never opens or lists them. */
  sensitive: string[];
  candidates(ctx: PathContext): Candidate[];
}
