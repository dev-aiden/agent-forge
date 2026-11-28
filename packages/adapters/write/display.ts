// What the renderer may see of a ChangeSet: the same changes, with secrets in
// MCP config masked. The real ChangeSet stays in the main process.
import { basename } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { MASK, maskArgs, maskUrl } from "@kitroom/model";
import type { ClaudeMcpDef } from "./claude-mcp";
import type { ChangeSet } from "./pipeline";

const SECRET_KEY = /(key|token|secret|password|passwd|auth|credential|bearer|cookie|session)/i;

const maskRecord = (r: unknown) =>
  r && typeof r === "object" && !Array.isArray(r) ? Object.fromEntries(Object.keys(r).map((k) => [k, MASK])) : r;

export function maskClaudeDef(def: ClaudeMcpDef | null): ClaudeMcpDef | null {
  if (!def) return null;
  return {
    ...def,
    args: maskArgs(def.args),
    env: maskRecord(def.env) as ClaudeMcpDef["env"],
    url: maskUrl(def.url),
    headers: maskRecord(def.headers) as ClaudeMcpDef["headers"],
  };
}

/** Masks MCP secrets in a Codex config.toml. Both sides of a diff go through the same serializer. */
export function maskCodexConfig(text: string | null): string | null {
  if (text === null) return null;
  try {
    const data = parseToml(text) as Record<string, unknown>;
    const servers = data.mcp_servers as Record<string, Record<string, unknown>> | undefined;
    for (const s of Object.values(servers ?? {})) {
      if (s.env) s.env = maskRecord(s.env);
      if (s.http_headers) s.http_headers = maskRecord(s.http_headers);
      if (Array.isArray(s.args)) s.args = maskArgs(s.args.map(String));
      if (typeof s.url === "string") s.url = maskUrl(s.url);
      // Other string fields with secret-looking names (bearer_token, ...).
      for (const [k, v] of Object.entries(s)) if (typeof v === "string" && SECRET_KEY.test(k)) s[k] = MASK;
    }
    return stringifyToml(data);
  } catch {
    return "(hidden: could not parse this file to hide secrets)";
  }
}

/** Masks MCP secrets in a Claude Code .mcp.json (project scope). */
export function maskMcpJson(text: string | null): string | null {
  if (text === null) return null;
  try {
    const data = JSON.parse(text) as { mcpServers?: Record<string, Record<string, unknown>> };
    for (const s of Object.values(data.mcpServers ?? {})) {
      if (!s || typeof s !== "object") continue;
      if (s.env) s.env = maskRecord(s.env);
      if (s.headers) s.headers = maskRecord(s.headers);
      if (Array.isArray(s.args)) s.args = maskArgs(s.args.map(String));
      if (typeof s.url === "string") s.url = maskUrl(s.url);
    }
    return `${JSON.stringify(data, null, 2)}\n`;
  } catch {
    return "(hidden: could not parse this file to hide secrets)";
  }
}

/** Settings keys whose values may hold secrets or run commands with secrets. */
const SETTINGS_SECRET_KEYS = new Set(["apiKeyHelper", "awsAuthRefresh", "awsCredentialExport", "otelHeadersHelper"]);

/**
 * Masks Claude Code settings.json for display: `env` values and secret-looking
 * string values anywhere (by key name). Permission lists stay readable.
 */
export function maskClaudeSettings(text: string | null): string | null {
  if (text === null) return null;
  const walk = (v: unknown, key = ""): unknown => {
    if (Array.isArray(v)) return key === "allow" || key === "ask" || key === "deny" ? v : v.map((x) => walk(x));
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          if (k === "env") return [k, maskRecord(x)];
          if (typeof x === "string" && (SETTINGS_SECRET_KEYS.has(k) || SECRET_KEY.test(k))) return [k, MASK];
          return [k, walk(x, k)];
        }),
      );
    }
    return v;
  };
  try {
    return `${JSON.stringify(walk(JSON.parse(text)), null, 2)}\n`;
  } catch {
    return "(hidden: could not parse this file to hide secrets)";
  }
}

/**
 * Which masker a tool file needs, by name. The only config.toml Kitroom writes is
 * Codex's (its folder may be $CODEX_HOME), and the only .mcp.json is Claude Code's.
 */
function maskerFor(path: string): ((text: string | null) => string | null) | null {
  const name = basename(path);
  if (name === "config.toml") return maskCodexConfig;
  if (name === ".mcp.json") return maskMcpJson;
  if (name === "settings.json") return maskClaudeSettings;
  return null;
}

export function displayChangeSet(set: ChangeSet): ChangeSet {
  return {
    ...set,
    changes: set.changes.map((c) => {
      const mask = maskerFor(c.path);
      return mask ? { ...c, before: mask(c.before), after: mask(c.after) } : c;
    }),
    commands: set.commands.map((c) => ({ ...c, before: maskClaudeDef(c.before), after: maskClaudeDef(c.after) })),
  };
}
