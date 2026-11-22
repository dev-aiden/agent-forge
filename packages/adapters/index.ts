// Public entry of @agent-forge/adapters.
import type { ToolConfig, ToolId } from "@agent-forge/model";
import { readClaude } from "./claude/read";
import { readCodex } from "./codex/read";
import type { PathContext } from "./types";

export { readClaude } from "./claude/read";
export { readCodex } from "./codex/read";
export { scan, TOOLS, type ScanResult, type ScanEntry, type ToolSummary } from "./scan";
export { isSensitive } from "./shared/read-utils";
export type { PathContext } from "./types";

/** Tools that have a read adapter so far. */
export const READERS: Partial<Record<ToolId, (ctx: PathContext) => Promise<ToolConfig>>> = {
  claude: readClaude,
  codex: readCodex,
};

// Writing app-managed items (preview → apply → undo).
export {
  apply,
  assertWritable,
  ConflictError,
  history,
  preview,
  undo,
  writableRoots,
  type ApplyManifest,
  type Change,
  type ChangeAction,
  type ChangeSet,
  type CommandEntry,
  type ManifestEntry,
  type PipelineRunners,
  type UndoResult,
  type Warning,
  type WorkerRunner,
} from "./write/pipeline";
export type { ClaudeCliRunner, ClaudeMcpDef, CommandChange } from "./write/claude-mcp";
export {
  deleteMcpServer,
  readManagedMcp,
  readManagedRule,
  saveManagedRule,
  saveMcpServer,
  unmanageMcp,
  unmanageRule,
} from "./write/config-store";
export { importMcp, importRule, type McpImportResult, type RuleImportResult } from "./write/import";
export { displayChangeSet } from "./write/display";
export { deleteAgent, deleteSkill, forgeHome, listAgents, listSkills, saveAgent, saveSkill, writeFileAtomic } from "./write/store";
