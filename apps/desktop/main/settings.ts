// App settings stored in ~/.agent-forge/settings.json (Agent Forge's own folder).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeHome, writeFileAtomic, type PathContext } from "@agent-forge/adapters";
import { TOOL_IDS, type ToolId } from "@agent-forge/model";
import type { AppSettings, Language } from "../shared/api";

export const DEFAULT_SETTINGS: AppSettings = { language: "system", disabledTools: [] };

const LANGUAGES: readonly Language[] = ["system", "en", "ko"];

function settingsPath(ctx: PathContext): string {
  return join(forgeHome(ctx), "settings.json");
}

/** Keeps only known values; anything else falls back to the default. */
export function sanitizeSettings(input: unknown): AppSettings {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const language = LANGUAGES.includes(s.language as Language) ? (s.language as Language) : DEFAULT_SETTINGS.language;
  const disabledTools = Array.isArray(s.disabledTools)
    ? [...new Set(s.disabledTools.filter((t): t is ToolId => TOOL_IDS.includes(t as ToolId)))]
    : [];
  return { language, disabledTools };
}

export async function readSettings(ctx: PathContext): Promise<AppSettings> {
  try {
    return sanitizeSettings(JSON.parse(await readFile(settingsPath(ctx), "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(ctx: PathContext, input: unknown): Promise<AppSettings> {
  const settings = sanitizeSettings(input);
  await writeFileAtomic(settingsPath(ctx), `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}
