import { useCallback, useEffect, useState } from "react";
import { PERMISSION_ACTIONS, type ManagedPermissions, type PermissionAction } from "@kitroom/model";
import type { GalleryTemplate } from "@kitroom/model/gallery";
import { useApplyFlow } from "../apply-flow";
import { TemplatePicker } from "../components/TemplatePicker";
import { errorText } from "../format";
import { useLang, useT } from "../i18n";

const ACTION_STYLE: Record<PermissionAction, string> = {
  allow: "text-emerald-300",
  ask: "text-amber-300",
  deny: "text-rose-300",
};

/** Claude Code settings.json. Permissions for now; hooks and other settings follow (#19, #22). */
export function ClaudeSettingsView({ shortPath }: { shortPath(path: string): string }) {
  const t = useT();
  const lang = useLang();
  const flow = useApplyFlow(shortPath);
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

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-neutral-800">
        <div className="flex-1 space-y-3 px-4 py-4 text-xs leading-relaxed text-neutral-400">
          <p>{t("claudeSettings.intro")}</p>
          <p>{t("permissions.intro")}</p>
          <p className="text-neutral-500">{t("permissions.claudeOnly")}</p>
        </div>
        {flow.historyList}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-2.5">
          <h2 className="text-sm font-medium text-neutral-100">{t("permissions.title")}</h2>
          <div className="ml-auto">{flow.previewButton(dirty, dirty ? t("agents.saveFirst") : undefined)}</div>
        </div>
        {flow.banners}

        {saved === undefined ? null : saved === null || !draft ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-neutral-400">{t("permissions.notManaged")}</p>
            <button className="btn-primary" onClick={startManaging}>
              {t("permissions.import")}
            </button>
          </div>
        ) : (
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
          </div>
        )}
      </section>

      {flow.dialog}
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
