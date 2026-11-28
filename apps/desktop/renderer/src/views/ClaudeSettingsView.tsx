import { useCallback, useEffect, useState } from "react";
import { CLAUDE_HOOK_EVENTS, PERMISSION_ACTIONS, type ClaudeHookGroup, type ManagedHooks, type ManagedPermissions, type PermissionAction } from "@kitroom/model";
import type { GalleryTemplate } from "@kitroom/model/gallery";
import { useApplyFlow } from "../apply-flow";
import { TemplatePicker } from "../components/TemplatePicker";
import { errorText } from "../format";
import { useLang, useT } from "../i18n";

type Flow = ReturnType<typeof useApplyFlow>;
type Section = "permissions" | "hooks";

/** Claude Code settings.json: permissions and hooks. Other settings follow (#22). */
export function ClaudeSettingsView({ shortPath }: { shortPath(path: string): string }) {
  const t = useT();
  const flow = useApplyFlow(shortPath);
  const [section, setSection] = useState<Section>("permissions");
  const [dirty, setDirty] = useState<Record<Section, boolean>>({ permissions: false, hooks: false });
  const anyDirty = dirty.permissions || dirty.hooks;
  const onDirty = useCallback((s: Section, d: boolean) => setDirty((x) => (x[s] === d ? x : { ...x, [s]: d })), []);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-neutral-800">
        <nav className="flex flex-col gap-0.5 border-b border-neutral-800 p-2">
          {(["permissions", "hooks"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`rounded px-3 py-1.5 text-left text-[13px] ${section === s ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900"}`}
            >
              {t(`${s}.title`)}
              {dirty[s] && <span className="ml-2 text-xs text-amber-400">•</span>}
            </button>
          ))}
        </nav>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-xs leading-relaxed text-neutral-400">
          <p>{t("claudeSettings.intro")}</p>
          <p>{t(section === "permissions" ? "permissions.intro" : "hooks.intro")}</p>
          <p className="text-neutral-500">{t(section === "permissions" ? "permissions.claudeOnly" : "hooks.claudeOnly")}</p>
        </div>
        {flow.historyList}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-2.5">
          <h2 className="text-sm font-medium text-neutral-100">{t(`${section}.title`)}</h2>
          <div className="ml-auto">{flow.previewButton(anyDirty, anyDirty ? t("agents.saveFirst") : undefined)}</div>
        </div>
        {flow.banners}
        <div className={section === "permissions" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <PermissionsPanel flow={flow} onDirty={(d) => onDirty("permissions", d)} />
        </div>
        <div className={section === "hooks" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <HooksPanel flow={flow} onDirty={(d) => onDirty("hooks", d)} />
        </div>
      </section>

      {flow.dialog}
    </div>
  );
}

function NotManaged({ text, button, onStart }: { text: string; button: string; onStart(): void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-neutral-400">{text}</p>
      <button className="btn-primary" onClick={onStart}>
        {button}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// permissions

const ACTION_STYLE: Record<PermissionAction, string> = {
  allow: "text-emerald-300",
  ask: "text-amber-300",
  deny: "text-rose-300",
};

function PermissionsPanel({ flow, onDirty }: { flow: Flow; onDirty(dirty: boolean): void }) {
  const t = useT();
  const lang = useLang();
  const [saved, setSaved] = useState<ManagedPermissions | null | undefined>(undefined);
  const [draft, setDraft] = useState<ManagedPermissions | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const p = await window.kitroom.getPermissions();
    setSaved(p);
    setDraft(p);
  }, []);

  useEffect(() => {
    load().catch((e) => flow.setError(errorText(e)));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => onDirty(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startManaging() {
    flow.setError(null);
    try {
      const r = await window.kitroom.importPermissions();
      await load();
      const reasons = r.skipped.map((s) => `${s.entry} (${t(`permissions.reason.${s.reason}`)})`).join(", ");
      flow.setNotice({
        text: [r.added ? t("permissions.imported", { n: r.added }) : t("permissions.importedEmpty"), r.skipped.length ? t("permissions.skipped", { list: reasons }) : ""]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function save() {
    if (!draft) return;
    flow.setError(null);
    try {
      const p = await window.kitroom.savePermissions(draft);
      setSaved(p);
      setDraft(p);
      flow.setNotice({ text: t("permissions.saved") });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function stop() {
    if (!confirm(t("permissions.unmanageConfirm"))) return;
    await window.kitroom.unmanagePermissions();
    await load();
  }

  /** Adds a template's rules to the (unsaved) lists. Rules already in a list stay where they are. */
  function addTemplate(tpl: GalleryTemplate) {
    if (tpl.kind !== "permissions" || !draft) return;
    setPicking(false);
    const next: ManagedPermissions = { allow: [...draft.allow], ask: [...draft.ask], deny: [...draft.deny] };
    const elsewhere: string[] = [];
    let added = 0;
    for (const a of PERMISSION_ACTIONS) {
      for (const e of tpl.permissions[a]) {
        const at = PERMISSION_ACTIONS.find((x) => next[x].includes(e));
        if (at === a) continue;
        if (at) elsewhere.push(e);
        else {
          next[a].push(e);
          added++;
        }
      }
    }
    setDraft(next);
    const title = tpl.title[lang];
    flow.setNotice({
      text: [added ? t("permissions.templateAdded", { title, n: added }) : t("gallery.already", { title }), elsewhere.length ? t("permissions.templateElsewhere", { list: elsewhere.join(", ") }) : ""]
        .filter(Boolean)
        .join(" "),
    });
  }

  if (saved === undefined) return null;
  if (saved === null || !draft) return <NotManaged text={t("permissions.notManaged")} button={t("permissions.import")} onStart={startManaging} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
      <div className="grid grid-cols-3 gap-4">
        {PERMISSION_ACTIONS.map((a) => (
          <RuleList key={a} action={a} rules={draft[a]} onChange={(rules) => setDraft({ ...draft, [a]: rules })} />
        ))}
      </div>
      <p className="text-xs text-neutral-500">{t("permissions.syntax")}</p>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={!dirty}>
          {t("agents.save")}
        </button>
        <button className="btn" onClick={() => setPicking(true)}>
          {t("permissions.addTemplate")}
        </button>
        <button className="btn" onClick={stop}>
          {t("rules.unmanage")}
        </button>
        {dirty && <span className="self-center text-xs text-amber-400">{t("agents.unsaved")}</span>}
      </div>
      {picking && <TemplatePicker kind="permissions" onPick={addTemplate} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** One of allow / ask / deny: entries with remove buttons and an input to add one. */
function RuleList({ action, rules, onChange }: { action: PermissionAction; rules: string[]; onChange(rules: string[]): void }) {
  const t = useT();
  const [input, setInput] = useState("");

  function add() {
    const entry = input.trim();
    if (!entry) return;
    if (!rules.includes(entry)) onChange([...rules, entry]);
    setInput("");
  }

  return (
    <div className="flex min-w-0 flex-col rounded border border-neutral-800">
      <div className="border-b border-neutral-800 px-3 py-2">
        <span className={`text-xs font-medium ${ACTION_STYLE[action]}`}>{t(`permissions.${action}`)}</span>
        <span className="ml-2 text-xs text-neutral-600">{t(`permissions.${action}Hint`)}</span>
      </div>
      <ul className="min-h-[120px] flex-1 divide-y divide-neutral-900">
        {rules.length === 0 && <li className="px-3 py-2 text-xs text-neutral-600">{t("list.none")}</li>}
        {rules.map((r) => (
          <li key={r} className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-neutral-200">{r}</span>
            <button className="text-xs text-neutral-500 hover:text-neutral-200" title={t("action.delete")} onClick={() => onChange(rules.filter((x) => x !== r))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-1 border-t border-neutral-800 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input min-w-0 flex-1 font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} placeholder={PLACEHOLDER[action]} />
        <button type="submit" className="btn" disabled={!input.trim()}>
          {t("permissions.add")}
        </button>
      </form>
    </div>
  );
}

const PLACEHOLDER: Record<PermissionAction, string> = {
  allow: "Bash(npm test:*)",
  ask: "Bash(git push:*)",
  deny: "Read(./.env)",
};

// ---------------------------------------------------------------------------
// hooks

/** Events that take a tool matcher; others run for every occurrence. */
const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PermissionRequest", "PostToolUseFailure"]);

function HooksPanel({ flow, onDirty }: { flow: Flow; onDirty(dirty: boolean): void }) {
  const t = useT();
  const lang = useLang();
  const [saved, setSaved] = useState<ManagedHooks | null | undefined>(undefined);
  const [draft, setDraft] = useState<ManagedHooks | null>(null);
  const [picking, setPicking] = useState(false);
  const [newEvent, setNewEvent] = useState(CLAUDE_HOOK_EVENTS[0]!);

  const load = useCallback(async () => {
    const h = await window.kitroom.getHooks();
    setSaved(h);
    setDraft(h);
  }, []);

  useEffect(() => {
    load().catch((e) => flow.setError(errorText(e)));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => onDirty(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startManaging() {
    flow.setError(null);
    try {
      const r = await window.kitroom.importHooks();
      await load();
      flow.setNotice({ text: r.hooks ? t("hooks.imported", { n: r.hooks, events: r.events }) : t("hooks.importedEmpty") });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function save() {
    if (!draft) return;
    flow.setError(null);
    try {
      const h = await window.kitroom.saveHooks(draft);
      setSaved(h);
      setDraft(h);
      flow.setNotice({ text: t("hooks.saved") });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function stop() {
    if (!confirm(t("hooks.unmanageConfirm"))) return;
    await window.kitroom.unmanageHooks();
    await load();
  }

  const setGroups = (event: string, groups: ClaudeHookGroup[]) => {
    if (!draft) return;
    const next = { ...draft };
    if (groups.length) next[event] = groups;
    else delete next[event];
    setDraft(next);
  };

  function addGroup(event: string, group: ClaudeHookGroup) {
    if (!draft) return;
    setDraft({ ...draft, [event]: [...(draft[event] ?? []), group] });
  }

  function addTemplate(tpl: GalleryTemplate) {
    if (tpl.kind !== "hook" || !draft) return;
    setPicking(false);
    const title = tpl.title[lang];
    const exists = (draft[tpl.event] ?? []).some((g) => g.hooks.some((h) => h.command === tpl.command));
    if (exists) {
      flow.setNotice({ text: t("gallery.already", { title }) });
      return;
    }
    addGroup(tpl.event, { matcher: tpl.matcher, hooks: [{ type: "command", command: tpl.command, ...(tpl.timeout ? { timeout: tpl.timeout } : {}) }] });
    flow.setNotice({ text: t("hooks.templateAdded", { title, event: tpl.event }) });
  }

  if (saved === undefined) return null;
  if (saved === null || !draft) return <NotManaged text={t("hooks.notManaged")} button={t("hooks.import")} onStart={startManaging} />;

  const events = Object.keys(draft);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
      <p className="rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">{t("hooks.warning")}</p>
      {events.length === 0 && <p className="text-xs text-neutral-500">{t("hooks.empty")}</p>}
      {events.map((event) => (
        <EventCard key={event} event={event} groups={draft[event]!} onChange={(g) => setGroups(event, g)} />
      ))}
      <div className="flex items-center gap-2">
        <select className="input w-auto font-mono text-xs" value={newEvent} onChange={(e) => setNewEvent(e.target.value)}>
          {CLAUDE_HOOK_EVENTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => addGroup(newEvent, { matcher: "", hooks: [{ type: "command", command: "" }] })}>
          {t("hooks.addHook")}
        </button>
      </div>
      <p className="text-xs text-neutral-500">{t("hooks.syntax")}</p>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={save} disabled={!dirty}>
          {t("agents.save")}
        </button>
        <button className="btn" onClick={() => setPicking(true)}>
          {t("permissions.addTemplate")}
        </button>
        <button className="btn" onClick={stop}>
          {t("rules.unmanage")}
        </button>
        {dirty && <span className="self-center text-xs text-amber-400">{t("agents.unsaved")}</span>}
      </div>
      {picking && <TemplatePicker kind="hook" onPick={addTemplate} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** One event: its matcher groups, each with commands (other hook types read-only). */
function EventCard({ event, groups, onChange }: { event: string; groups: ClaudeHookGroup[]; onChange(groups: ClaudeHookGroup[]): void }) {
  const t = useT();
  const tool = TOOL_EVENTS.has(event);
  const setGroup = (i: number, g: ClaudeHookGroup | null) => onChange(groups.flatMap((x, j) => (j !== i ? [x] : g && g.hooks.length ? [g] : [])));

  return (
    <div className="rounded border border-neutral-800">
      <div className="border-b border-neutral-800 px-3 py-2">
        <span className="font-mono text-xs font-medium text-neutral-100">{event}</span>
        {CLAUDE_HOOK_EVENTS.includes(event) && <span className="ml-2 text-xs text-neutral-600">{t(`hooks.event.${event}` as Parameters<typeof t>[0])}</span>}
      </div>
      <div className="divide-y divide-neutral-900">
        {groups.map((g, i) => (
          <div key={g.ref ?? `new-${i}`} className="space-y-2 px-3 py-2">
            {(tool || g.matcher) && (
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                {t("hooks.matcher")}
                <input
                  className="input w-64 font-mono text-xs"
                  value={g.matcher}
                  onChange={(e) => setGroup(i, { ...g, matcher: e.target.value })}
                  placeholder={t("hooks.matcherAll")}
                />
              </label>
            )}
            {g.hooks.map((h, k) => {
              const setHook = (next: typeof h | null) => setGroup(i, { ...g, hooks: g.hooks.flatMap((x, j) => (j !== k ? [x] : next ? [next] : [])) });
              return (
                <div key={h.ref ?? `new-${k}`} className="flex items-start gap-2">
                  {h.type === "command" ? (
                    <>
                      <textarea
                        className="input min-h-[36px] flex-1 font-mono text-xs"
                        rows={Math.min(4, Math.max(1, Math.ceil((h.command ?? "").length / 90)))}
                        value={h.command ?? ""}
                        onChange={(e) => setHook({ ...h, command: e.target.value })}
                        placeholder="./scripts/check.sh"
                      />
                      <input
                        className="input w-20 font-mono text-xs"
                        type="number"
                        min={1}
                        value={h.timeout ?? ""}
                        onChange={(e) => setHook({ ...h, timeout: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder={t("hooks.timeout")}
                        title={t("hooks.timeoutTip")}
                      />
                    </>
                  ) : (
                    <p className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-400" title={t("hooks.readOnlyTip")}>
                      {h.type} · {t("hooks.readOnly")}
                    </p>
                  )}
                  <button className="pt-1.5 text-xs text-neutral-500 hover:text-neutral-200" title={t("action.delete")} onClick={() => setHook(null)}>
                    ×
                  </button>
                </div>
              );
            })}
            <button className="text-xs text-sky-400 hover:text-sky-300" onClick={() => setGroup(i, { ...g, hooks: [...g.hooks, { type: "command", command: "" }] })}>
              + {t("hooks.addCommand")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
