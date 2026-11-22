// Preview → apply → undo flow shared by every editing screen (agents, skills,
// rules, MCP). One "Preview & apply" applies everything Agent Forge manages.
import { useCallback, useEffect, useState } from "react";
import type { ApplySummary, ChangeSet } from "../../shared/api";
import { PreviewDialog } from "./components/PreviewDialog";
import { errorText } from "./format";
import { useT } from "./i18n";

export interface Notice {
  text: string;
  undoId?: string;
}

export function useApplyFlow(shortPath: (path: string) => string) {
  const t = useT();
  const [history, setHistory] = useState<ApplySummary[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChangeSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => setHistory(await window.agentForge.history()), []);

  useEffect(() => {
    refreshHistory().catch((e) => setError(errorText(e)));
  }, [refreshHistory]);

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
      await refreshHistory();
      const n = result.manifest.fileCount + result.manifest.commandCount;
      setNotice({ text: t("agents.applied", { n }), undoId: result.manifest.id });
    } catch (e) {
      setPreviewError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function undoApply(id: string) {
    try {
      const r = await window.agentForge.undo(id);
      await refreshHistory();
      setNotice({
        text:
          t("agents.restored", { n: r.restored.length }) +
          (r.skipped.length ? " " + t("agents.keptEdited", { n: r.skipped.length, files: r.skipped.map(shortPath).join(", ") }) : ""),
      });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const previewButton = (disabled: boolean, title?: string) => (
    <button className="btn-primary" onClick={openPreview} disabled={busy || disabled} title={title ?? t("agents.previewTip")}>
      {busy && !preview ? t("agents.preparing") : t("agents.preview")}
    </button>
  );

  const banners = (
    <>
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
    </>
  );

  const historyList = (
    <section className="max-h-[40%] overflow-y-auto border-t border-neutral-800">
      <h3 className="sticky top-0 bg-neutral-950 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {t("agents.history")}
      </h3>
      {history.length === 0 && <p className="px-3 pb-3 text-xs text-neutral-600">{t("agents.historyEmpty")}</p>}
      <ul>
        {history.slice(0, 10).map((h) => (
          <li key={h.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="text-neutral-400">{new Date(h.createdAt).toLocaleString()}</span>
            <span className="text-neutral-600">
              {h.commandCount ? t("history.summary", { files: h.fileCount, commands: h.commandCount }) : t("agents.files", { n: h.fileCount })}
            </span>
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
  );

  const dialog = preview && (
    <PreviewDialog
      set={preview}
      busy={busy}
      error={previewError}
      shortPath={shortPath}
      onApply={applyPreview}
      onCancel={() => setPreview(null)}
    />
  );

  return { busy, setError, setNotice, previewButton, banners, historyList, dialog };
}
