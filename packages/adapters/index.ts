// Public entry of @agent-forge/adapters.
import type { ToolConfig, ToolId } from "@agent-forge/model";
import { readAntigravity } from "./antigravity/read";
import { readClaude } from "./claude/read";
import { readCodex } from "./codex/read";
import { readCopilot } from "./copilot/read";
import type { PathContext } from "./types";

export { readAntigravity } from "./antigravity/read";
export { readClaude } from "./claude/read";
export { readCodex } from "./codex/read";
export { readCopilot } from "./copilot/read";
export { scan, TOOLS, type ScanResult, type ScanEntry, type ToolSummary } from "./scan";
export { isSensitive } from "./shared/read-utils";
export type { PathContext } from "./types";

/** Read adapter per tool. */
export const READERS: Record<ToolId, (ctx: PathContext) => Promise<ToolConfig>> = {
  claude: readClaude,
  codex: readCodex,
  copilot: readCopilot,
  antigravity: readAntigravity,
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
export {
  importAgents,
  importMcp,
  importRule,
  importSkills,
  type ImportSkipReason,
  type ItemImportResult,
  type McpImportResult,
  type RuleImportResult,
} from "./write/import";
export { displayChangeSet } from "./write/display";
export { deleteAgent, deleteSkill, forgeHome, listAgents, listSkills, saveAgent, saveSkill, writeFileAtomic } from "./write/store";
