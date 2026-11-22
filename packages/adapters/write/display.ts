// What the renderer may see of a ChangeSet: the same changes, with secrets in
// MCP config masked. The real ChangeSet stays in the main process.
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { MASK, maskArgs, maskUrl } from "@agent-forge/model";
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

export function displayChangeSet(set: ChangeSet, isCodexConfig: (path: string) => boolean): ChangeSet {
  return {
    ...set,
    changes: set.changes.map((c) =>
      isCodexConfig(c.path) ? { ...c, before: maskCodexConfig(c.before), after: maskCodexConfig(c.after) } : c,
    ),
    commands: set.commands.map((c) => ({ ...c, before: maskClaudeDef(c.before), after: maskClaudeDef(c.after) })),
  };
}
