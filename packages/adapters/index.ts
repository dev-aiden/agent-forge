// Public entry of @agent-forge/adapters.
import type { ToolConfig, ToolId } from "@agent-forge/model";
import { readClaude } from "./claude/read";
import { readCodex } from "./codex/read";
import type { PathContext } from "./types";

export { readClaude } from "./claude/read";
export { readCodex } from "./codex/read";
export { scan, TOOLS, type ScanResult, type ScanEntry, type ToolSummary } from "./scan";
export type { PathContext } from "./types";

/** Tools that have a read adapter so far. */
export const READERS: Partial<Record<ToolId, (ctx: PathContext) => Promise<ToolConfig>>> = {
  claude: readClaude,
  codex: readCodex,
};
