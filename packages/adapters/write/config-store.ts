// App-managed global rule and MCP servers, stored as a rulesync source tree:
//
//   ~/.kitroom/source/rules/root.md   global top-level instructions (root rule)
//   ~/.kitroom/source/mcp.jsonc       MCP servers (contains secrets → mode 0600)
//
// A missing file means "not managed by Kitroom": nothing is generated for it.
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import {
  MANAGED_NAME,
  MASK,
  maskArgs,
  maskUrl,
  RULESYNC_TARGET,
  WRITABLE_AGENT_TOOLS,
  type ManagedMcpServer,
  type ManagedRule,
  type McpTransport,
  type ToolId,
} from "@kitroom/model";
import { Reader, splitFrontmatter, str, stringList, stringRecord } from "../shared/read-utils";
import type { PathContext } from "../types";
import { forgePaths, writeFileAtomic } from "./store";

const RULESYNC_TO_TOOL = Object.fromEntries(Object.entries(RULESYNC_TARGET).map(([k, v]) => [v, k as ToolId]));

function targetsFrom(v: unknown): ToolId[] {
  return (stringList(v) ?? [])
    .map((t) => (t === "*" ? WRITABLE_AGENT_TOOLS : [RULESYNC_TO_TOOL[t]]))
    .flat()
    .filter((t): t is ToolId => Boolean(t) && WRITABLE_AGENT_TOOLS.includes(t));
}

function cleanTargets(targets: ToolId[]): ToolId[] {
  const set = [...new Set(targets)].filter((t) => WRITABLE_AGENT_TOOLS.includes(t));
  if (set.length === 0) throw new Error("Select at least one tool.");
  return set;
}

export function configPaths(ctx: PathContext) {
  const { source } = forgePaths(ctx);
  return { rule: join(source, "rules", "root.md"), mcp: join(source, "mcp.jsonc") };
}

// ---------------------------------------------------------------------------
// global rule

export async function readManagedRule(ctx: PathContext): Promise<ManagedRule | null> {
  const r = new Reader();
  const path = configPaths(ctx).rule;
  const text = await r.text(path);
  if (text === null) return null;
  const { data, body } = splitFrontmatter(r, path, text);
  return { body, targets: [...new Set(targetsFrom(data.targets))] };
}

export async function saveManagedRule(ctx: PathContext, rule: ManagedRule): Promise<ManagedRule> {
  const clean = { body: rule.body, targets: cleanTargets(rule.targets) };
  const front = { root: true, targets: clean.targets.map((t) => RULESYNC_TARGET[t]) };
  const body = clean.body.endsWith("\n") ? clean.body : `${clean.body}\n`;
  await writeFileAtomic(configPaths(ctx).rule, `---\n${stringifyYaml(front)}---\n${body}`);
  return clean;
}

/** Stops managing the global rule. Tool files are left as they are. */
export async function unmanageRule(ctx: PathContext): Promise<void> {
  await rm(configPaths(ctx).rule, { force: true });
}

// ---------------------------------------------------------------------------
// MCP servers

/** Keys Kitroom models itself; everything else in an entry is Codex-only extra. */
const OWNED_KEYS = new Set(["type", "command", "args", "env", "url", "headers", "targets", "disabled"]);
/** Codex keys never passed through: rulesync keeps `tools` from the real config.toml, the rest are modeled. */
const NOT_EXTRA = new Set(["command", "args", "env", "url", "http_headers", "tools", "__proto__", "constructor", "prototype"]);

/** Codex-only fields from a config.toml server table, kept verbatim (rulesync passes unknown keys through). */
export function codexExtraFrom(extra: Record<string, unknown>, enabled: boolean): Record<string, unknown> | undefined {
  const out = Object.fromEntries(Object.entries(extra).filter(([k]) => !NOT_EXTRA.has(k) && !OWNED_KEYS.has(k)));
  if (!enabled) out.enabled = false;
  return Object.keys(out).length ? out : undefined;
}

function toRulesyncEntry(s: ManagedMcpServer): Record<string, unknown> {
  // Codex extras first so modeled fields always win. Only the Codex output reads them
  // (Claude Code is changed through its CLI from the modeled fields).
  const { enabled, ...extra } = s.codexExtra ?? {};
  const e: Record<string, unknown> = { ...extra, type: s.transport };
  // rulesync drops a server written with `enabled = false`; its spelling is `disabled`.
  if (enabled === false) e.disabled = true;
  if (s.command) e.command = s.command;
  if (s.args?.length) e.args = s.args;
  if (s.env && Object.keys(s.env).length) e.env = s.env;
  if (s.url) e.url = s.url;
  if (s.headers && Object.keys(s.headers).length) e.headers = s.headers;
  e.targets = s.targets.map((t) => RULESYNC_TARGET[t]);
  return e;
}

function fromRulesyncEntry(name: string, v: unknown): ManagedMcpServer | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  const type = str(e.type);
  const transport: McpTransport = type === "http" || type === "sse" ? type : "stdio";
  const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !OWNED_KEYS.has(k) && !NOT_EXTRA.has(k)));
  if (e.disabled === true) extra.enabled = false;
  return {
    name,
    transport,
    command: str(e.command),
    args: Array.isArray(e.args) ? e.args.map(String) : undefined,
    env: stringRecord(e.env),
    url: str(e.url),
    headers: stringRecord(e.headers),
    targets: e.targets === undefined ? [...WRITABLE_AGENT_TOOLS] : targetsFrom(e.targets),
    codexExtra: Object.keys(extra).length ? extra : undefined,
  };
}

/** Managed MCP servers, or null when Kitroom does not manage MCP yet. Values are NOT masked. */
export async function readManagedMcp(ctx: PathContext): Promise<ManagedMcpServer[] | null> {
  const r = new Reader();
  const data = (await r.json(configPaths(ctx).mcp)) as { mcpServers?: Record<string, unknown> } | undefined;
  if (data === undefined) return null;
  return Object.entries(data.mcpServers ?? {})
    .map(([name, v]) => fromRulesyncEntry(name, v))
    .filter((s): s is ManagedMcpServer => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeManagedMcp(ctx: PathContext, servers: ManagedMcpServer[]): Promise<void> {
  const path = configPaths(ctx).mcp;
  const mcpServers = Object.fromEntries(servers.map((s) => [s.name, toRulesyncEntry(s)]));
  // Contains secrets: readable by the user only (ignored on Windows).
  await writeFileAtomic(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`, 0o600);
  await chmod(path, 0o600).catch(() => undefined);
}

/** Stops managing MCP. Tool config is left as it is. */
export async function unmanageMcp(ctx: PathContext): Promise<void> {
  await rm(configPaths(ctx).mcp, { force: true });
}

function validateServer(s: ManagedMcpServer): void {
  if (!MANAGED_NAME.test(s.name)) {
    throw new Error("Name must start with a letter or digit and contain only letters, digits, '-' or '_' (max 64).");
  }
  if (s.transport === "stdio" && !s.command) throw new Error("A stdio server needs a command.");
  if (s.transport !== "stdio" && !s.url) throw new Error("An HTTP/SSE server needs a URL.");
}

/**
 * Restores secret values the renderer only saw masked: an env/header value equal
 * to MASK keeps the stored value; args / url equal to their masked form are kept.
 */
export function unmaskEdit(incoming: ManagedMcpServer, stored: ManagedMcpServer | undefined): ManagedMcpServer {
  const record = (next?: Record<string, string>, prev?: Record<string, string>) => {
    if (!next) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) {
      if (v === MASK) {
        if (prev?.[k] === undefined) throw new Error(`Enter a value for ${k}.`);
        out[k] = prev[k];
      } else out[k] = v;
    }
    return out;
  };
  let args = incoming.args;
  if (stored && JSON.stringify(args ?? []) === JSON.stringify(maskArgs(stored.args) ?? [])) args = stored.args;
  else if (args?.some((a) => a.includes(MASK))) throw new Error("Re-enter the hidden argument values.");
  let url = incoming.url;
  if (stored && url === maskUrl(stored.url)) url = stored.url;
  else if (url?.includes(MASK)) throw new Error("Re-enter the hidden URL values.");
  return {
    ...incoming,
    // Not editable in the app (and masked in the renderer): always the stored value.
    codexExtra: stored?.codexExtra,
    args,
    url,
    env: record(incoming.env, stored?.env),
    headers: record(incoming.headers, stored?.headers),
  };
}

/** Adds or updates one server. `previousName` renames. Starts managing MCP if needed. */
export async function saveMcpServer(ctx: PathContext, input: ManagedMcpServer, previousName?: string): Promise<ManagedMcpServer> {
  const list = (await readManagedMcp(ctx)) ?? [];
  const stored = list.find((s) => s.name === (previousName ?? input.name));
  const server = unmaskEdit({ ...input, name: input.name.trim(), targets: cleanTargets(input.targets) }, stored);
  validateServer(server);
  if (list.some((s) => s.name.toLowerCase() === server.name.toLowerCase() && s.name !== (previousName ?? server.name))) {
    throw new Error(`An MCP server named "${server.name}" already exists.`);
  }
  const next = list.filter((s) => s.name !== (previousName ?? server.name));
  next.push(server);
  await writeManagedMcp(ctx, next);
  return server;
}

export async function deleteMcpServer(ctx: PathContext, name: string): Promise<void> {
  const list = await readManagedMcp(ctx);
  if (!list) return;
  await writeManagedMcp(ctx, list.filter((s) => s.name !== name));
}
