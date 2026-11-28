// Starter templates shipped with the app (the repo's `gallery/` folder).
//
// Templates are plain files so they are easy to contribute:
//   gallery/agents/<name>.md   frontmatter + instructions
//   gallery/skills/<name>.md   frontmatter + SKILL.md body
//   gallery/rules/<id>.md      frontmatter + a section to append to the top-level rules
//   gallery/mcp/<name>.json    { title, summary, server }
//   gallery/permissions/<id>.json  { title, summary, allow?, ask?, deny? } (Claude Code rules)
//
// Frontmatter is a flat list of `key: value` lines (no YAML features), so the
// parser stays small and runs in the renderer without dependencies.
import {
  MANAGED_NAME,
  PERMISSION_ACTIONS,
  RESERVED_SKILL_NAMES,
  type ManagedAgent,
  type ManagedMcpServer,
  type ManagedPermissions,
  type ManagedSkill,
  type McpTransport,
} from "./index";

export interface Localized {
  en: string;
  ko: string;
}

interface TemplateMeta {
  /** File name without extension. Equals the item name for agents, skills and MCP servers. */
  id: string;
  title: Localized;
  summary: Localized;
}

export type GalleryTemplate =
  | (TemplateMeta & { kind: "agent"; agent: Omit<ManagedAgent, "targets"> })
  | (TemplateMeta & { kind: "skill"; skill: Omit<ManagedSkill, "targets"> })
  | (TemplateMeta & { kind: "rule"; body: string })
  | (TemplateMeta & { kind: "mcp"; server: Omit<ManagedMcpServer, "targets" | "codexExtra"> })
  | (TemplateMeta & { kind: "permissions"; permissions: ManagedPermissions });

export type GalleryKind = GalleryTemplate["kind"];

const FOLDER_KIND: Record<string, GalleryKind> = { agents: "agent", skills: "skill", rules: "rule", mcp: "mcp", permissions: "permissions" };

/** `Tool` or `Tool(pattern)` (full checks against rulesync live in the adapters' tests). */
const PERMISSION_RULE = /^[A-Za-z0-9_*-]+(\([\s\S]+\))?$/;

const ALLOWED_KEYS: Record<"agent" | "skill" | "rule", readonly string[]> = {
  agent: ["name", "description", "model", "tools"],
  skill: ["name", "description"],
  rule: [],
};
const META_KEYS = ["title.en", "title.ko", "summary.en", "summary.ko"];

function splitFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const src = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error("missing --- frontmatter ---");
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([a-z.]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`bad frontmatter line: ${line}`);
    if (kv[1]! in meta) throw new Error(`duplicate key: ${kv[1]}`);
    meta[kv[1]!] = kv[2]!.trim();
  }
  return { meta, body: m[2]!.trim() + "\n" };
}

function localized(o: unknown, what: string): Localized {
  const r = o as Partial<Localized> | undefined;
  if (!r || typeof r.en !== "string" || typeof r.ko !== "string" || !r.en.trim() || !r.ko.trim()) {
    throw new Error(`${what} needs non-empty "en" and "ko"`);
  }
  return { en: r.en.trim(), ko: r.ko.trim() };
}

function checkName(name: string | undefined, id: string, kind: GalleryKind): string {
  if (!name || !MANAGED_NAME.test(name)) throw new Error(`invalid name: ${name ?? "(missing)"}`);
  if (name !== id) throw new Error(`name "${name}" must match the file name "${id}"`);
  if (kind === "skill" && RESERVED_SKILL_NAMES.includes(name)) throw new Error(`reserved skill name: ${name}`);
  return name;
}

const stringRecord = (o: unknown, what: string): Record<string, string> | undefined => {
  if (o === undefined) return undefined;
  if (!o || typeof o !== "object" || Array.isArray(o) || Object.values(o).some((v) => typeof v !== "string")) {
    throw new Error(`${what} must be an object of strings`);
  }
  return o as Record<string, string>;
};

/** Parses one template file. Throws with a short reason if it is malformed. */
export function parseTemplate(kind: GalleryKind, id: string, text: string): GalleryTemplate {
  if (kind === "permissions") {
    const j = JSON.parse(text) as Record<string, unknown>;
    const unknownKeys = Object.keys(j).filter((k) => !["title", "summary", ...PERMISSION_ACTIONS].includes(k));
    if (unknownKeys.length) throw new Error(`unknown keys: ${unknownKeys.join(", ")}`);
    const permissions: ManagedPermissions = { allow: [], ask: [], deny: [] };
    for (const a of PERMISSION_ACTIONS) {
      const v = j[a] ?? [];
      if (!Array.isArray(v) || v.some((e) => typeof e !== "string" || !PERMISSION_RULE.test(e))) throw new Error(`${a} must be a list of Tool(pattern) rules`);
      permissions[a] = v as string[];
    }
    if (PERMISSION_ACTIONS.every((a) => permissions[a].length === 0)) throw new Error("no rules");
    return { kind, id, title: localized(j.title, "title"), summary: localized(j.summary, "summary"), permissions };
  }
  if (kind === "mcp") {
    const j = JSON.parse(text) as { title?: unknown; summary?: unknown; server?: Record<string, unknown> };
    const s = j.server ?? {};
    const unknownKeys = Object.keys(s).filter((k) => !["name", "transport", "command", "args", "env", "url", "headers"].includes(k));
    if (unknownKeys.length) throw new Error(`unknown server keys: ${unknownKeys.join(", ")}`);
    const transport = s.transport as McpTransport;
    if (!["stdio", "http", "sse"].includes(transport)) throw new Error(`bad transport: ${String(s.transport)}`);
    const args = s.args;
    if (args !== undefined && (!Array.isArray(args) || args.some((a) => typeof a !== "string"))) throw new Error("args must be strings");
    const server = {
      name: checkName(s.name as string | undefined, id, kind),
      transport,
      command: s.command as string | undefined,
      args: args as string[] | undefined,
      env: stringRecord(s.env, "env"),
      url: s.url as string | undefined,
      headers: stringRecord(s.headers, "headers"),
    };
    if (transport === "stdio" && (typeof server.command !== "string" || !server.command)) throw new Error("stdio server needs a command");
    if (transport !== "stdio" && (typeof server.url !== "string" || !/^https?:\/\//.test(server.url))) throw new Error("remote server needs an http(s) url");
    return { kind, id, title: localized(j.title, "title"), summary: localized(j.summary, "summary"), server };
  }

  const { meta, body } = splitFrontmatter(text);
  const allowed = [...META_KEYS, ...ALLOWED_KEYS[kind]];
  const extra = Object.keys(meta).filter((k) => !allowed.includes(k));
  if (extra.length) throw new Error(`unknown keys: ${extra.join(", ")}`);
  const title = localized({ en: meta["title.en"], ko: meta["title.ko"] }, "title");
  const summary = localized({ en: meta["summary.en"], ko: meta["summary.ko"] }, "summary");
  if (!body.trim()) throw new Error("empty body");
  if (kind === "rule") return { kind, id, title, summary, body };

  const name = checkName(meta.name, id, kind);
  const description = meta.description ?? "";
  if (!description) throw new Error("missing description");
  if (kind === "skill") return { kind, id, title, summary, skill: { name, description, body } };
  const tools = meta.tools ? meta.tools.split(",").map((x) => x.trim()).filter(Boolean) : [];
  return { kind, id, title, summary, agent: { name, description, body, model: meta.model || undefined, tools } };
}

/**
 * Builds the gallery from `{ path: text }` (e.g. Vite's import.meta.glob or a
 * directory read). The kind comes from the parent folder, the id from the file name.
 */
export function loadGallery(files: Record<string, string>): GalleryTemplate[] {
  const out: GalleryTemplate[] = [];
  for (const [path, text] of Object.entries(files)) {
    const parts = path.replace(/\\/g, "/").split("/");
    const file = parts.at(-1)!;
    const kind = FOLDER_KIND[parts.at(-2) ?? ""];
    if (!kind) continue;
    const id = file.replace(/\.(md|json)$/, "");
    try {
      out.push(parseTemplate(kind, id, text));
    } catch (e) {
      throw new Error(`gallery/${parts.at(-2)}/${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/** First free name: `name`, then `name-2`, `name-3`, ... */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let i = 2; ; i++) if (!set.has(`${name}-${i}`)) return `${name}-${i}`;
}
