// App settings stored in ~/.kitroom/settings.json (Kitroom's own folder).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeHome, writeFileAtomic, type PathContext } from "@kitroom/adapters";
import { TOOL_IDS, type ToolId } from "@kitroom/model";
import { TERMINAL_FONT_SIZE, type AppSettings, type Language, type Theme } from "../shared/api";

export const DEFAULT_SETTINGS: AppSettings = {
  language: "system",
  theme: "system",
  terminalFontSize: TERMINAL_FONT_SIZE.default,
  disabledTools: [],
  checkUpdates: true,
};

const LANGUAGES: readonly Language[] = ["system", "en", "ko"];
const THEMES: readonly Theme[] = ["system", "light", "dark"];

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
  const theme = THEMES.includes(s.theme as Theme) ? (s.theme as Theme) : DEFAULT_SETTINGS.theme;
  const size = Number(s.terminalFontSize);
  const terminalFontSize = Number.isInteger(size) && size >= TERMINAL_FONT_SIZE.min && size <= TERMINAL_FONT_SIZE.max
    ? size
    : DEFAULT_SETTINGS.terminalFontSize;
  const checkUpdates = typeof s.checkUpdates === "boolean" ? s.checkUpdates : DEFAULT_SETTINGS.checkUpdates;
  return { language, theme, terminalFontSize, disabledTools, checkUpdates };
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
