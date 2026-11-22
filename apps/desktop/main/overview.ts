// Builds the read-only config overview sent to the renderer.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { READERS, scan, type PathContext } from "@agent-forge/adapters";
import { maskToolConfig } from "@agent-forge/model";
import type { Overview, ToolOverview } from "../shared/api";

/** Identity of an overview ignoring the read time, used to skip no-op updates. */
export function overviewFingerprint(overview: Overview): string {
  return JSON.stringify([overview.project, overview.tools]);
}

/** Accepts null or an absolute path to an existing directory; anything else is rejected. */
export async function validateProject(project: unknown): Promise<string | null> {
  if (project === null || project === undefined) return null;
  if (typeof project !== "string" || !isAbsolute(project)) throw new Error("project must be an absolute path");
  const st = await stat(project).catch(() => null);
  if (!st?.isDirectory()) throw new Error("project directory not found");
  return project;
}

export async function buildOverview(
  project: string | null,
  home: string = homedir(),
  env: PathContext["env"] = process.env,
): Promise<Overview> {
  const ctx: PathContext = { home, project: project ?? "", env };
  const scanned = await scan(ctx);

  const tools = await Promise.all(
    scanned.tools.map(async (t): Promise<ToolOverview> => {
      const read = READERS[t.id];
      // Secrets in MCP config never leave the main process unmasked.
      const config = t.detected && read ? maskToolConfig(await read(ctx)) : null;
      return { id: t.id, label: t.label, binary: t.binary, detected: t.detected, supported: Boolean(read), config };
    }),
  );

  return { home: ctx.home, project, tools, readAt: new Date().toISOString() };
}
