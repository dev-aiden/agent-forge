// Claude Code hooks (settings.json `hooks`), managed by Kitroom:
//
//   ~/.kitroom/source/claude-hooks.json   { "hooks": <Claude Code's hooks object, as is> }   (mode 0600)
//
// Not converted by rulesync on purpose: hooks are commands Claude Code runs on its
// own, and rulesync rewrites commands (`./x.sh` → `"$CLAUDE_PROJECT_DIR"/x.sh`) and
// drops events it does not own. Kitroom stores and writes the object exactly as
// the user wrote it. Claude Code only; Codex hooks are issue #50.
//
// The app edits matcher, command and timeout. Other fields and other hook types
// (prompt, agent, http) are kept from the stored hook, found again by `ref`, and
// are masked before they reach the renderer (http hooks can carry tokens).
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { MASK, maskUrl, type ClaudeHook, type ClaudeHookGroup, type ManagedHooks } from "@kitroom/model";
import { Reader } from "../shared/read-utils";
import type { PathContext } from "../types";
import { claudeSettingsPath } from "./permissions";
import { forgePaths, writeFileAtomic } from "./store";

type Json = Record<string, unknown>;
/** Claude Code's own shape: event → matcher groups → hooks. */
export type RawHooks = Record<string, Json[]>;

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const SECRET_KEY = /(key|token|secret|password|passwd|auth|credential|bearer|cookie|session)/i;

export function hooksPath(ctx: PathContext): string {
  return join(forgePaths(ctx).source, "claude-hooks.json");
}

/** Checks the shape Claude Code expects; returns it as RawHooks or throws. */
export function asRawHooks(v: unknown): RawHooks {
  if (v === undefined) return {};
  if (!isObject(v)) throw new Error("hooks must be an object of events");
  for (const [event, groups] of Object.entries(v)) {
    if (!EVENT_NAME.test(event)) throw new Error(`invalid hook event name: ${event}`);
    if (!Array.isArray(groups) || groups.some((g) => !isObject(g) || !Array.isArray(g.hooks) || g.hooks.some((h) => !isObject(h) || typeof h.type !== "string"))) {
      throw new Error(`hooks for ${event} are not in Claude Code's format ([{ matcher, hooks: [{ type, ... }] }])`);
    }
  }
  return v as RawHooks;
}

export async function readStoredHooks(ctx: PathContext): Promise<RawHooks | null> {
  const r = new Reader();
  const data = (await r.json(hooksPath(ctx))) as { hooks?: unknown } | undefined;
  if (!data) return null;
  return asRawHooks(data.hooks);
}

async function writeStoredHooks(ctx: PathContext, hooks: RawHooks): Promise<void> {
  // Hooks may hold tokens (http hook headers): user-only permissions.
  await writeFileAtomic(hooksPath(ctx), `${JSON.stringify({ hooks }, null, 2)}\n`, 0o600);
}

/** Hides values that may be secrets in fields the form does not edit. */
function maskExtra(v: unknown, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => maskExtra(x));
  if (isObject(v)) {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => {
        if ((k === "env" || k === "headers") && isObject(x)) return [k, Object.fromEntries(Object.keys(x).map((n) => [n, MASK]))];
        return [k, maskExtra(x, k)];
      }),
    );
  }
  if (typeof v === "string") {
    if (key === "url") return maskUrl(v);
    if (SECRET_KEY.test(key)) return MASK;
  }
  return v;
}

/** The stored hooks as the app shows them (masked extras, refs to the stored items). */
export function toView(raw: RawHooks): ManagedHooks {
  const out: ManagedHooks = {};
  for (const [event, groups] of Object.entries(raw)) {
    out[event] = groups.map((g, gi): ClaudeHookGroup => ({
      matcher: typeof g.matcher === "string" ? g.matcher : "",
      ref: `${event}/${gi}`,
      hooks: (g.hooks as Json[]).map((h, hi): ClaudeHook => {
        const { type, command, timeout, ...rest } = h;
        return {
          type: String(type),
          ...(typeof command === "string" ? { command } : {}),
          ...(typeof timeout === "number" ? { timeout } : {}),
          ...(Object.keys(rest).length ? { extra: maskExtra(rest) as Json } : {}),
          ref: `${event}/${gi}/${hi}`,
        };
      }),
    }));
  }
  return out;
}

function byRef(raw: RawHooks, ref: string | undefined): Json | undefined {
  if (!ref) return undefined;
  const [event, gi, hi] = ref.split("/");
  const group = Object.hasOwn(raw, event ?? "") ? raw[event!]?.[Number(gi)] : undefined;
  if (!group) return undefined;
  return hi === undefined ? group : (group.hooks as Json[])[Number(hi)];
}

/**
 * Builds the stored object from what the app sent. Fields the form does not edit,
 * and hooks of other types, come from the stored hooks (never from the renderer).
 */
export function fromView(view: ManagedHooks, stored: RawHooks): RawHooks {
  if (!isObject(view)) throw new Error("hooks must be an object of events");
  const out: RawHooks = {};
  for (const [event, groups] of Object.entries(view)) {
    if (!EVENT_NAME.test(event)) throw new Error(`"${event}" is not a hook event name.`);
    if (!Array.isArray(groups)) throw new Error(`hooks for ${event} must be a list`);
    const outGroups: Json[] = [];
    for (const g of groups) {
      const orig = byRef(stored, g.ref);
      const { matcher: origMatcher, hooks: _hooks, ...groupRest } = orig ?? {};
      const hooks: Json[] = [];
      for (const h of g.hooks ?? []) {
        const origHook = byRef(stored, h.ref);
        if (origHook && origHook.type !== "command") {
          hooks.push(origHook); // other hook types are read-only: kept exactly
          continue;
        }
        if ((h.type ?? "command") !== "command") throw new Error(`Only command hooks can be added in Kitroom (${event}).`);
        const command = typeof h.command === "string" ? h.command.trim() : "";
        if (!command) throw new Error(`A ${event} hook has no command.`);
        if (h.timeout !== undefined && h.timeout !== null && !(typeof h.timeout === "number" && Number.isFinite(h.timeout) && h.timeout > 0)) {
          throw new Error(`Timeout must be a positive number of seconds (${event}).`);
        }
        const { type: _t, command: _c, timeout: _to, ...rest } = origHook ?? {};
        hooks.push({ type: "command", command, ...(typeof h.timeout === "number" ? { timeout: h.timeout } : {}), ...rest });
      }
      if (hooks.length === 0) continue;
      const matcher = typeof g.matcher === "string" ? g.matcher.trim() : "";
      // An explicit empty matcher stays as it was written.
      const keepEmpty = matcher === "" && origMatcher === "";
      outGroups.push({ ...(matcher || keepEmpty ? { matcher } : {}), hooks, ...groupRest });
    }
    if (outGroups.length) out[event] = outGroups;
  }
  return out;
}

export async function readManagedHooks(ctx: PathContext): Promise<ManagedHooks | null> {
  const raw = await readStoredHooks(ctx);
  return raw === null ? null : toView(raw);
}

export async function saveManagedHooks(ctx: PathContext, view: ManagedHooks): Promise<ManagedHooks> {
  const stored = (await readStoredHooks(ctx)) ?? {};
  const next = fromView(view, stored);
  await writeStoredHooks(ctx, next);
  return toView(next);
}

export async function unmanageHooks(ctx: PathContext): Promise<void> {
  await rm(hooksPath(ctx), { force: true });
}

/** Starts managing the scope's settings.json hooks, kept exactly as they are. */
export async function importHooks(ctx: PathContext): Promise<{ events: number; hooks: number }> {
  const existing = await readStoredHooks(ctx);
  const count = (raw: RawHooks) => ({
    events: Object.keys(raw).length,
    hooks: Object.values(raw).flat().reduce((n, g) => n + (g.hooks as unknown[]).length, 0),
  });
  if (existing) return count(existing);
  const r = new Reader();
  const path = claudeSettingsPath(ctx);
  const settings = (await r.json(path)) as Json | undefined;
  if (r.issues.length) throw new Error(`Could not read ${path}: ${r.issues[0]!.message}`);
  const raw = asRawHooks(settings?.hooks);
  await writeStoredHooks(ctx, raw);
  return count(raw);
}

/** Command hooks in `after` that are new or changed compared with `before` (for the preview). */
export function changedHookCommands(before: unknown, after: unknown): { event: string; command: string }[] {
  const list = (v: unknown) => {
    const out = new Set<string>();
    if (!isObject(v)) return out;
    for (const [event, groups] of Object.entries(v)) {
      if (!Array.isArray(groups)) continue;
      for (const g of groups) {
        if (!isObject(g) || !Array.isArray(g.hooks)) continue;
        for (const h of g.hooks) if (isObject(h) && typeof h.command === "string") out.add(JSON.stringify([event, String(g.matcher ?? ""), h.command]));
      }
    }
    return out;
  };
  const old = list(before);
  return [...list(after)]
    .filter((k) => !old.has(k))
    .map((k) => JSON.parse(k) as [string, string, string])
    .map(([event, , command]) => ({ event, command }));
}
