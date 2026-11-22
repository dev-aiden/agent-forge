import { useCallback, useEffect, useState } from "react";
import type { ManagedRule } from "@agent-forge/model";
import { useApplyFlow } from "../apply-flow";
import { Field, TargetPicker, TOOL_LABEL } from "../components/Form";
import { errorText } from "../format";
import { useT } from "../i18n";

/** The global top-level instructions (CLAUDE.md / AGENTS.md). */
export function RulesView({ shortPath }: { shortPath(path: string): string }) {
  const t = useT();
  const flow = useApplyFlow(shortPath);
  const [rule, setRule] = useState<ManagedRule | null | undefined>(undefined);
  const [draft, setDraft] = useState<ManagedRule | null>(null);

  const load = useCallback(async () => {
    const r = await window.agentForge.getRule();
    setRule(r);
    setDraft(r);
  }, []);

  useEffect(() => {
    load().catch((e) => flow.setError(errorText(e)));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(rule);

  async function startManaging() {
    try {
      const r = await window.agentForge.importRule();
      await load();
      flow.setNotice({
        text: [r.from ? t("rules.imported", { tool: TOOL_LABEL[r.from] }) : t("rules.importedEmpty"), r.differs ? t("rules.differs") : ""]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function save() {
    if (!draft) return;
    try {
      const saved = await window.agentForge.saveRule(draft);
      setRule(saved);
      setDraft(saved);
      flow.setNotice({ text: t("rules.saved") });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function stop() {
    if (!confirm(t("rules.unmanageConfirm"))) return;
    await window.agentForge.unmanageRule();
    await load();
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-neutral-800">
        <p className="flex-1 px-4 py-4 text-xs leading-relaxed text-neutral-400">{t("rules.intro")}</p>
        {flow.historyList}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-2.5">
          <h2 className="text-sm font-medium text-neutral-100">{t("rules.title")}</h2>
          <div className="ml-auto">{flow.previewButton(dirty, dirty ? t("agents.saveFirst") : undefined)}</div>
        </div>
        {flow.banners}

        {rule === undefined ? null : rule === null || !draft ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-neutral-400">{t("rules.notManaged")}</p>
            <button className="btn-primary" onClick={startManaging}>
              {t("rules.import")}
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <Field label={t("agents.applyTo")}>
              <TargetPicker value={draft.targets} onChange={(targets) => setDraft({ ...draft, targets })} />
            </Field>
            <Field label={t("rules.body")}>
              <textarea
                className="input min-h-[360px] font-mono text-xs leading-relaxed"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={save} disabled={!dirty}>
                {t("agents.save")}
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
    </div>
  );
}
