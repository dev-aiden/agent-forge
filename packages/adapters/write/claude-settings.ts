// Claude Code settings.json, written by Kitroom for permissions and hooks.
//
// Kitroom changes only the keys it manages (`permissions.allow/ask/deny`, `hooks`)
// and leaves everything else as the user wrote it, formatting included. If the
// result means the same as the file (permission lists in another order), the file
// is kept byte for byte.
import { isDeepStrictEqual } from "node:util";
import { PERMISSION_ACTIONS } from "@kitroom/model";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Permission lists sorted, so order alone is not a change. */
function normalized(settings: Json): Json {
  const perms = settings.permissions;
  if (!isObject(perms)) return settings;
  const sorted: Json = { ...perms };
  for (const a of PERMISSION_ACTIONS) if (Array.isArray(perms[a])) sorted[a] = [...(perms[a] as unknown[])].map(String).sort();
  return { ...settings, permissions: sorted };
}

export interface ClaudeSettingsPatch {
  /** New allow / ask / deny lists (from rulesync's generated settings.json). */
  permissions?: Record<(typeof PERMISSION_ACTIONS)[number], string[]>;
  /** New `hooks` object (Claude Code's own shape, written as is). Empty = remove the key. */
  hooks?: Json;
}

/**
 * The new settings.json text, `before` itself when nothing changes, or null when
 * there is no file and nothing worth creating.
 */
export function buildClaudeSettings(before: string | null, patch: ClaudeSettingsPatch): string | null {
  const base = before === null ? {} : (JSON.parse(before) as Json);
  if (!isObject(base)) throw new Error("settings.json is not a JSON object");
  const next: Json = { ...base };
  if (patch.permissions) {
    const perms: Json = { ...(isObject(base.permissions) ? base.permissions : {}) };
    for (const a of PERMISSION_ACTIONS) {
      if (patch.permissions[a].length) perms[a] = patch.permissions[a];
      else delete perms[a];
    }
    if (Object.keys(perms).length) next.permissions = perms;
    else delete next.permissions;
  }
  if (patch.hooks) {
    if (Object.keys(patch.hooks).length) next.hooks = patch.hooks;
    else delete next.hooks;
  }
  if (before !== null && isDeepStrictEqual(normalized(base), normalized(next))) return before;
  if (before === null && Object.keys(next).length === 0) return null;
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** allow / ask / deny lists from a settings.json text (missing lists are empty). */
export function permissionListsOf(text: string): Record<(typeof PERMISSION_ACTIONS)[number], string[]> {
  const perms = (JSON.parse(text) as Json).permissions;
  const p = isObject(perms) ? perms : {};
  return Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a, Array.isArray(p[a]) ? (p[a] as unknown[]).map(String) : []])) as Record<
    (typeof PERMISSION_ACTIONS)[number],
    string[]
  >;
}
