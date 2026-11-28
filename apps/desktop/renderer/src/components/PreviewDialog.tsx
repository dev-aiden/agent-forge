import { useState } from "react";
import type { Change, ChangeSet, CommandChange } from "../../../shared/api";
import { useT } from "../i18n";
import { Badge } from "./Badges";
import { DiffView } from "./DiffView";
import { TOOL_LABEL } from "./Form";

const ACTION_STYLE: Record<Change["action"], string> = {
  create: "border-emerald-800 text-emerald-300",
  modify: "border-amber-800 text-amber-300",
  delete: "border-red-800 text-red-300",
  unchanged: "border-neutral-700 text-neutral-500",
};

const COMMAND_STYLE: Record<CommandChange["action"], string> = {
  add: ACTION_STYLE.create,
  replace: ACTION_STYLE.modify,
  remove: ACTION_STYLE.delete,
  unchanged: ACTION_STYLE.unchanged,
};

interface Props {
  set: ChangeSet;
  busy: boolean;
  error: string | null;
  shortPath(path: string): string;
  onApply(): void;
  onCancel(): void;
}

const json = (v: unknown) => (v === null ? null : `${JSON.stringify(v, null, 2)}\n`);

/** Shows exactly what will change before anything is written or run. Secrets arrive masked. */
export function PreviewDialog({ set, busy, error, shortPath, onApply, onCancel }: Props) {
  const t = useT();
  const pending = set.changes.filter((c) => c.action !== "unchanged");
  const commands = set.commands.filter((c) => c.action !== "unchanged");
  const total = pending.length + commands.length;
  const unchanged = set.changes.length - pending.length;
  const [open, setOpen] = useState<string | null>(pending[0]?.path ?? (commands[0] ? `cmd:${commands[0].name}` : null));
  const toggle = (key: string) => setOpen(open === key ? null : key);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/75 backdrop-blur-[1px] p-8">
      <div className="flex max-h-full w-full max-w-4xl flex-col rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl">
        <header className="border-b border-neutral-800 px-5 py-4">
          <h2 className="text-base font-semibold text-neutral-100">{t("preview.title")}</h2>
          <p className="mt-1 text-xs text-neutral-400">
            {total === 0
              ? t("preview.upToDate")
              : t("preview.summary", { n: total, unchanged: unchanged ? t("preview.unchanged", { n: unchanged }) : "" })}
          </p>
        </header>

        {(set.warnings.length > 0 || set.blocked) && (
          <div className="space-y-1 border-b border-amber-900 bg-amber-950/40 px-5 py-2 text-xs text-amber-200">
            {set.warnings.map((w) => {
              switch (w.kind) {
                case "unmanaged-mcp":
                  return <p key={w.kind + w.tool}>{t("preview.unmanagedMcp", { tool: TOOL_LABEL[w.tool], names: w.names.join(", ") })}</p>;
                case "codex-rule-override":
                  return <p key={w.kind}>{t("preview.codexOverride", { path: shortPath(w.path) })}</p>;
                case "project-mcp":
                  return <p key={w.kind}>{t("preview.projectMcp")}</p>;
                case "project-mcp-secrets":
                  return <p key={w.kind}>{t("preview.projectMcpSecrets", { names: w.names.join(", ") })}</p>;
                case "removed-permissions":
                  return <p key={w.kind}>{t("preview.removedPermissions", { entries: w.entries.join(", ") })}</p>;
                case "hook-commands":
                  return (
                    <div key={w.kind}>
                      <p>{t("preview.hookCommands")}</p>
                      <ul className="mt-1 space-y-0.5">
                        {w.commands.map((c, i) => (
                          <li key={i} className="break-all font-mono">
                            {c.event}: {c.command}
                          </li>
                        ))}
                      </ul>
                      {w.project && <p className="mt-1">{t("preview.hookCommandsProject")}</p>}
                    </div>
                  );
                case "moved-commands":
                  return <p key={w.kind}>{t("preview.movedCommands", { paths: w.paths.map(shortPath).join(", ") })}</p>;
              }
            })}
            {set.blocked && <p className="text-red-300">{t(set.blocked === "inside-session" ? "preview.blockedSession" : "preview.blocked")}</p>}
          </div>
        )}

        <ul className="min-h-0 flex-1 divide-y divide-neutral-800 overflow-y-auto">
          {pending.map((c) => (
            <li key={c.path} className="px-5 py-3">
              <button className="flex w-full items-center gap-2 text-left" onClick={() => toggle(c.path)}>
                <Badge className={ACTION_STYLE[c.action]}>{t(`action.${c.action}`)}</Badge>
                <span className="truncate font-mono text-xs text-neutral-200">{shortPath(c.path)}</span>
                <span className="ml-auto text-xs text-neutral-500">{open === c.path ? t("preview.hideDiff") : t("preview.showDiff")}</span>
              </button>
              {c.merged && (
                <p className="mt-2 text-xs text-sky-300">{t(/[\\/]settings\.json$/.test(c.path) ? "preview.mergedSettings" : "preview.merged")}</p>
              )}
              {c.unmanagedOverwrite && <p className="mt-2 text-xs text-amber-300">{t("preview.unmanaged")}</p>}
              {open === c.path && (
                <div className="mt-2">
                  <DiffView before={c.before} after={c.after} />
                </div>
              )}
            </li>
          ))}

          {commands.length > 0 && (
            <li className="bg-neutral-950/40 px-5 py-2 text-xs text-neutral-400">
              <span className="font-medium text-neutral-300">{t("preview.commandsTitle")}</span> — {t("preview.commandsNote")}
            </li>
          )}
          {commands.map((c) => {
            const key = `cmd:${c.name}`;
            return (
              <li key={key} className="px-5 py-3">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => toggle(key)}>
                  <Badge className={COMMAND_STYLE[c.action]}>{t(`cmd.${c.action}`)}</Badge>
                  <span className="truncate font-mono text-xs text-neutral-200">
                    claude mcp {c.action === "remove" ? "remove" : "add-json"} {c.name} -s user
                  </span>
                  <span className="ml-auto text-xs text-neutral-500">{open === key ? t("preview.hideDiff") : t("preview.showDiff")}</span>
                </button>
                {open === key && (
                  <div className="mt-2">
                    <DiffView before={json(c.before)} after={json(c.after)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && <div className="border-t border-red-900 bg-red-950/50 px-5 py-2 text-xs text-red-300">{error}</div>}

        <footer className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {t("action.cancel")}
          </button>
          <button className="btn-primary" onClick={onApply} disabled={busy || total === 0 || Boolean(set.blocked)}>
            {busy ? t("preview.applying") : t("preview.apply", { n: total })}
          </button>
        </footer>
      </div>
    </div>
  );
}
