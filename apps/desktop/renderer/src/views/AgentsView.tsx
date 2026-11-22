import { useCallback, useEffect, useMemo, useState } from "react";
import { WRITABLE_AGENT_TOOLS, type ManagedAgent, type ToolId } from "@agent-forge/model";
import type { ApplyManifest, ChangeSet } from "../../../shared/api";
import { Badge } from "../components/Badges";
import { PreviewDialog } from "../components/PreviewDialog";
import { errorText } from "../format";
import { useT } from "../i18n";

const TOOL_LABEL: Record<ToolId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  copilot: "Copilot CLI",
  antigravity: "Antigravity CLI",
};

interface Draft {
  name: string;
  description: string;
  body: string;
  model: string;
  tools: string;
  targets: ToolId[];
}

const EMPTY: Draft = { name: "", description: "", body: "", model: "", tools: "", targets: [...WRITABLE_AGENT_TOOLS] };

function toDraft(a: ManagedAgent): Draft {
  return { name: a.name, description: a.description, body: a.body, model: a.model ?? "", tools: a.tools?.join(", ") ?? "", targets: a.targets };
}

function fromDraft(d: Draft): ManagedAgent {
  return {
    name: d.name.trim(),
    description: d.description.trim(),
    body: d.body,
    model: d.model.trim() || undefined,
    tools: d.tools.split(",").map((t) => t.trim()).filter(Boolean),
    targets: d.targets,
  };
}

export function AgentsView({ shortPath }: { shortPath(path: string): string }) {
  const t = useT();
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [history, setHistory] = useState<ApplyManifest[]>([]);
  /** null = new agent */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undoId?: string } | null>(null);
  const [preview, setPreview] = useState<ChangeSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const refresh = useCallback(async () => {
    const [a, h] = await Promise.all([window.agentForge.listAgents(), window.agentForge.history()]);
    setAgents(a);
    setHistory(h);
    return a;
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(errorText(e)));
  }, [refresh]);

  function select(agent: ManagedAgent | null) {
    if (dirty && !confirm(t("agents.discard"))) return;
    const d = agent ? toDraft(agent) : EMPTY;
    setEditing(agent?.name ?? null);
    setDraft(d);
    setSaved(d);
    setError(null);
  }

  async function save() {
    setError(null);
    try {
      const agent = await window.agentForge.saveAgent(fromDraft(draft), editing ?? undefined);
      await refresh();
      const d = toDraft(agent);
      setEditing(agent.name);
      setDraft(d);
      setSaved(d);
      setNotice({ text: t("agents.saved", { name: agent.name }) });
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove() {
    if (!editing || !confirm(t("agents.confirmDelete", { name: editing }))) return;
    await window.agentForge.deleteAgent(editing);
    await refresh();
    setEditing(null);
    setDraft(EMPTY);
    setSaved(EMPTY);
    setNotice({ text: t("agents.deleted", { name: editing }) });
  }

  async function openPreview() {
    setError(null);
    setPreviewError(null);
    setBusy(true);
    try {
      setPreview(await window.agentForge.previewApply());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!preview) return;
    setBusy(true);
    setPreviewError(null);
    try {
      const result = await window.agentForge.apply(preview.id);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      setPreview(null);
      await refresh();
      setNotice({ text: t("agents.applied", { n: result.manifest.entries.length }), undoId: result.manifest.id });
    } catch (e) {
      setPreviewError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function undoApply(id: string) {
    try {
      const r = await window.agentForge.undo(id);
      await refresh();
      setNotice({
        text:
          t("agents.restored", { n: r.restored.length }) +
          (r.skipped.length ? " " + t("agents.keptEdited", { n: r.skipped.length, files: r.skipped.map(shortPath).join(", ") }) : ""),
      });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleTarget = (t: ToolId) =>
    set("targets", draft.targets.includes(t) ? draft.targets.filter((x) => x !== t) : [...draft.targets, t]);

  const recent = useMemo(() => history.slice(0, 10), [history]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: agents + history */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-neutral-800">
        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t("agents.title")}</span>
          <button className="btn" onClick={() => select(null)}>
            {t("agents.new")}
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {agents.length === 0 && <li className="px-3 py-3 text-xs text-neutral-600">{t("agents.empty")}</li>}
          {agents.map((a) => (
            <li key={a.name}>
              <button
                onClick={() => select(a)}
                className={`block w-full px-3 py-2 text-left ${a.name === editing ? "bg-neutral-800" : "hover:bg-neutral-900"}`}
              >
                <div className="truncate text-[13px] text-neutral-100">{a.name}</div>
                <div className="truncate text-xs text-neutral-500">{a.description}</div>
                <div className="mt-1 flex gap-1">
                  {a.targets.map((t) => (
                    <Badge key={t} className="border-neutral-700 text-neutral-400">
                      {TOOL_LABEL[t]}
                    </Badge>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <section className="max-h-[40%] overflow-y-auto border-t border-neutral-800">
          <h3 className="sticky top-0 bg-neutral-950 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            {t("agents.history")}
          </h3>
          {recent.length === 0 && <p className="px-3 pb-3 text-xs text-neutral-600">{t("agents.historyEmpty")}</p>}
          <ul>
            {recent.map((h) => (
              <li key={h.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="text-neutral-400">{new Date(h.createdAt).toLocaleString()}</span>
                <span className="text-neutral-600">{t("agents.files", { n: h.entries.length })}</span>
                {h.undoneAt ? (
                  <span className="ml-auto text-neutral-600">{t("agents.undone")}</span>
                ) : (
                  <button className="ml-auto text-sky-400 hover:underline" onClick={() => undoApply(h.id)}>
                    {t("action.undo")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </aside>

      {/* Right: editor */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-2.5">
          <h2 className="text-sm font-medium text-neutral-100">{editing ? t("agents.editTitle", { name: editing }) : t("agents.newTitle")}</h2>
          <span className="text-xs text-neutral-500">{t("agents.scopeNote")}</span>
          <button
            className="btn-primary ml-auto"
            onClick={openPreview}
            disabled={busy || dirty}
            title={dirty ? t("agents.saveFirst") : t("agents.previewTip")}
          >
            {busy && !preview ? t("agents.preparing") : t("agents.preview")}
          </button>
        </div>

        {notice && (
          <div className="flex items-center gap-3 border-b border-emerald-900 bg-emerald-950/40 px-5 py-2 text-xs text-emerald-200">
            <span>{notice.text}</span>
            {notice.undoId && (
              <button className="text-sky-300 hover:underline" onClick={() => undoApply(notice.undoId!)}>
                {t("action.undo")}
              </button>
            )}
            <button className="ml-auto text-neutral-500 hover:text-neutral-300" onClick={() => setNotice(null)}>
              {t("action.dismiss")}
            </button>
          </div>
        )}
        {error && <div className="border-b border-red-900 bg-red-950/50 px-5 py-2 text-xs text-red-300">{error}</div>}

        <form
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t("agents.name")} hint={t("agents.nameHint")}>
            <input className="input font-mono" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="code-reviewer" />
          </Field>
          <Field label={t("agents.description")} hint={t("agents.descriptionHint")}>
            <input className="input" value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder={t("agents.descriptionPlaceholder")} />
          </Field>
          <Field label={t("agents.applyTo")}>
            <div className="flex gap-4">
              {WRITABLE_AGENT_TOOLS.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.targets.includes(t)} onChange={() => toggleTarget(t)} />
                  {TOOL_LABEL[t]}
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("agents.model")} hint={t("agents.modelHint")}>
              <input className="input font-mono" value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="sonnet" />
            </Field>
            <Field label={t("agents.tools")} hint={t("agents.toolsHint")}>
              <input className="input font-mono" value={draft.tools} onChange={(e) => set("tools", e.target.value)} placeholder="Read, Grep, Glob" />
            </Field>
          </div>
          <Field label={t("agents.instructions")}>
            <textarea
              className="input min-h-[240px] font-mono text-xs leading-relaxed"
              value={draft.body}
              onChange={(e) => set("body", e.target.value)}
              placeholder={t("agents.instructionsPlaceholder")}
            />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={!dirty}>
              {editing ? t("agents.save") : t("agents.create")}
            </button>
            {editing && (
              <button type="button" className="btn" onClick={remove}>
                {t("agents.delete")}
              </button>
            )}
            {dirty && <span className="self-center text-xs text-amber-400">{t("agents.unsaved")}</span>}
          </div>
        </form>
      </section>

      {preview && (
        <PreviewDialog
          set={preview}
          busy={busy}
          error={previewError}
          shortPath={shortPath}
          onApply={applyPreview}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-medium text-neutral-300">{label}</span>
      {hint && <span className="ml-2 text-xs text-neutral-600">{hint}</span>}
      <div className="mt-1">{children}</div>
    </div>
  );
}
