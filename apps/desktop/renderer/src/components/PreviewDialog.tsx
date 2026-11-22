import { useState } from "react";
import type { Change, ChangeSet } from "../../../shared/api";
import { useT } from "../i18n";
import { Badge } from "./Badges";
import { DiffView } from "./DiffView";

const ACTION_STYLE: Record<Change["action"], string> = {
  create: "border-emerald-800 text-emerald-300",
  modify: "border-amber-800 text-amber-300",
  delete: "border-red-800 text-red-300",
  unchanged: "border-neutral-700 text-neutral-500",
};

interface Props {
  set: ChangeSet;
  busy: boolean;
  error: string | null;
  shortPath(path: string): string;
  onApply(): void;
  onCancel(): void;
}

/** Shows exactly what will change on disk before anything is written. */
export function PreviewDialog({ set, busy, error, shortPath, onApply, onCancel }: Props) {
  const t = useT();
  const pending = set.changes.filter((c) => c.action !== "unchanged");
  const unchanged = set.changes.length - pending.length;
  const [open, setOpen] = useState<string | null>(pending[0]?.path ?? null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl">
        <header className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-base font-semibold text-neutral-100">{t("preview.title")}</h2>
          <p className="mt-1 text-xs text-neutral-400">
            {pending.length === 0
              ? t("preview.upToDate")
              : t("preview.summary", { n: pending.length, unchanged: unchanged ? t("preview.unchanged", { n: unchanged }) : "" })}
          </p>
        </header>

        <ul className="min-h-0 flex-1 divide-y divide-neutral-800 overflow-y-auto">
          {pending.map((c) => (
            <li key={c.path} className="px-5 py-3">
              <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === c.path ? null : c.path)}>
                <Badge className={ACTION_STYLE[c.action]}>{t(`action.${c.action}`)}</Badge>
                <span className="truncate font-mono text-xs text-neutral-200">{shortPath(c.path)}</span>
                <span className="ml-auto text-xs text-neutral-500">{open === c.path ? t("preview.hideDiff") : t("preview.showDiff")}</span>
              </button>
              {c.unmanagedOverwrite && (
                <p className="mt-2 text-xs text-amber-300">
                  {t("preview.unmanaged")}
                </p>
              )}
              {open === c.path && (
                <div className="mt-2">
                  <DiffView before={c.before} after={c.after} />
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && <div className="border-t border-red-900 bg-red-950/50 px-5 py-2 text-xs text-red-300">{error}</div>}

        <footer className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {t("action.cancel")}
          </button>
          <button className="btn-primary" onClick={onApply} disabled={busy || pending.length === 0}>
            {busy ? t("preview.applying") : t("preview.apply", { n: pending.length })}
          </button>
        </footer>
      </div>
    </div>
  );
}
