import { useCallback, useEffect, useState } from "react";
import { WRITABLE_AGENT_TOOLS, type ManagedAgent, type ManagedKind, type ManagedSkill, type ToolId } from "@kitroom/model";
import { uniqueName, type GalleryTemplate } from "@kitroom/model/gallery";
import { useApplyFlow } from "../apply-flow";
import { Badge } from "../components/Badges";
import { Field, TargetPicker, TOOL_LABEL } from "../components/Form";
import { TemplatePicker } from "../components/TemplatePicker";
import type { LegacyCommand } from "../../../shared/api";
import { errorText } from "../format";
import { useLang, useT } from "../i18n";

interface Draft {
  name: string;
  description: string;
  body: string;
  model: string;
  tools: string;
  targets: ToolId[];
  /** Skills only. */
  userOnly: boolean;
  argumentHint: string;
}

const EMPTY: Draft = { name: "", description: "", body: "", model: "", tools: "", targets: [...WRITABLE_AGENT_TOOLS], userOnly: false, argumentHint: "" };

type Managed = ManagedAgent | ManagedSkill;

function toDraft(a: Managed): Draft {
  const model = "model" in a ? (a.model ?? "") : "";
  const tools = "tools" in a ? (a.tools?.join(", ") ?? "") : "";
  const skill = a as ManagedSkill;
  return { name: a.name, description: a.description, body: a.body, model, tools, targets: a.targets, userOnly: skill.userOnly ?? false, argumentHint: skill.argumentHint ?? "" };
}

function fromDraft(kind: ManagedKind, d: Draft): Managed {
  const base = { name: d.name.trim(), description: d.description.trim(), body: d.body, targets: d.targets };
  if (kind === "skill") return { ...base, userOnly: d.userOnly || undefined, argumentHint: d.argumentHint.trim() || undefined };
  return {
    ...base,
    model: d.model.trim() || undefined,
    tools: d.tools.split(",").map((x) => x.trim()).filter(Boolean),
  };
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Fields and files Kitroom keeps but does not edit (from imported items). */
function keptOf(item: Managed | undefined): { extras: string[]; files: string[] } | null {
  if (!item) return null;
  const lines = (prefix: string, r?: Record<string, unknown>) => Object.entries(r ?? {}).map(([k, v]) => `${prefix}${k}: ${show(v)}`);
  if ("claudeExtra" in item || "codexExtra" in item) {
    const a = item as ManagedAgent;
    return { extras: [...lines("Claude Code · ", a.claudeExtra), ...lines("Codex · ", a.codexExtra)], files: [] };
  }
  const { claudecode, codexcli, ...rest } = (item as ManagedSkill).extra ?? {};
  const section = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);
  return {
    extras: [...lines("", rest), ...lines("Claude Code · ", section(claudecode)), ...lines("Codex · ", section(codexcli))],
    files: (item as ManagedSkill).files ?? [],
  };
}

/** Per-kind data functions and labels. */
function kindConfig(kind: ManagedKind) {
  const api = window.kitroom;
  return kind === "agent"
    ? {
        list: () => api.listAgents() as Promise<Managed[]>,
        importAll: () => api.importAgents(),
        importStart: "import.startAgents",
        save: (item: Managed, prev?: string) => api.saveAgent(item as ManagedAgent, prev) as Promise<Managed>,
        remove: (name: string) => api.deleteAgent(name),
        label: {
          title: "agents.title",
          empty: "agents.empty",
          newTitle: "agents.newTitle",
          create: "agents.create",
          nameHint: "agents.nameHint",
          descriptionHint: "agents.descriptionHint",
          descriptionPlaceholder: "agents.descriptionPlaceholder",
          body: "agents.instructions",
          bodyPlaceholder: "agents.instructionsPlaceholder",
        },
      } as const
    : {
        list: () => api.listSkills() as Promise<Managed[]>,
        importAll: () => api.importSkills(),
        importStart: "import.startSkills",
        save: (item: Managed, prev?: string) => api.saveSkill(item as ManagedSkill, prev) as Promise<Managed>,
        remove: (name: string) => api.deleteSkill(name),
        label: {
          title: "skills.title",
          empty: "skills.empty",
          newTitle: "skills.newTitle",
          create: "skills.create",
          nameHint: "skills.nameHint",
          descriptionHint: "skills.descriptionHint",
          descriptionPlaceholder: "skills.descriptionPlaceholder",
          body: "skills.body",
          bodyPlaceholder: "skills.bodyPlaceholder",
        },
      } as const;
}

export function ManagedView({ kind, shortPath }: { kind: ManagedKind; shortPath(path: string): string }) {
  const t = useT();
  const cfg = kindConfig(kind);
  const L = cfg.label;
  // Applying can delete moved commands: reload the list afterwards.
  const flow = useApplyFlow(shortPath, () => void refresh().catch((e) => flow.setError(errorText(e))));
  const [items, setItems] = useState<Managed[]>([]);
  /** null = new item */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const [picking, setPicking] = useState(false);
  /** Skills view: custom commands / prompts that can be moved into skills. */
  const [commands, setCommands] = useState<LegacyCommand[]>([]);
  const [moving, setMoving] = useState<LegacyCommand | null>(null);
  const lang = useLang();

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const refresh = useCallback(async () => {
    setItems(await cfg.list());
    if (kind === "skill") setCommands(await window.kitroom.listCommands());
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh().catch((e) => flow.setError(errorText(e)));
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  function select(item: Managed | null) {
    if (dirty && !confirm(t("agents.discard"))) return;
    const d = item ? toDraft(item) : EMPTY;
    setEditing(item?.name ?? null);
    setDraft(d);
    setSaved(d);
    flow.setError(null);
  }

  async function doImport() {
    if (dirty && !confirm(t("agents.discard"))) return;
    flow.setError(null);
    try {
      const r = await cfg.importAll();
      await refresh();
      const reasons = r.skipped.map((x) => `${x.name} (${t(`import.reason.${x.reason}`)})`).join(", ");
      flow.setNotice({
        text: [
          r.added.length ? t("import.result", { n: r.added.length, names: r.added.join(", ") }) : t("import.none"),
          r.conflicts.length ? t("import.conflicts", { names: r.conflicts.join(", ") }) : "",
          r.skipped.length ? t("import.skipped", { list: reasons }) : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  /** Fills the form with a template as a new, unsaved item. */
  function pickTemplate(tpl: GalleryTemplate) {
    if (tpl.kind !== "agent" && tpl.kind !== "skill") return;
    if (dirty && !confirm(t("agents.discard"))) return;
    const item: Managed = tpl.kind === "agent" ? { ...tpl.agent, targets: EMPTY.targets } : { ...tpl.skill, targets: EMPTY.targets };
    const name = uniqueName(item.name, items.map((i) => i.name));
    setPicking(false);
    setEditing(null);
    setSaved(EMPTY);
    setDraft(toDraft({ ...item, name }));
    flow.setError(null);
    const title = tpl.title[lang];
    flow.setNotice({ text: [t("gallery.loaded", { title }), name !== item.name ? t("gallery.renamed", { name }) : ""].filter(Boolean).join(" ") });
  }

  async function save() {
    flow.setError(null);
    try {
      const item = await cfg.save(fromDraft(kind, draft), editing ?? undefined);
      await refresh();
      const d = toDraft(item);
      setEditing(item.name);
      setDraft(d);
      setSaved(d);
      flow.setNotice({ text: t("agents.saved", { name: item.name }) });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  function startMove(c: LegacyCommand) {
    if (dirty && !confirm(t("agents.discard"))) return;
    flow.setError(null);
    setMoving(c);
  }

  async function move(c: LegacyCommand, removeOriginal: boolean) {
    setMoving(null);
    try {
      const r = await window.kitroom.moveCommand(c.tool, c.name, removeOriginal);
      await refresh();
      const d = toDraft(r.skill);
      setEditing(r.skill.name);
      setDraft(d);
      setSaved(d);
      flow.setNotice({
        text: [t("commands.moved", { name: c.name }), t(r.removalPlanned ? "commands.movedRemove" : "commands.movedKeep")].join(" "),
      });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function remove() {
    if (!editing || !confirm(t("agents.confirmDelete", { name: editing }))) return;
    await cfg.remove(editing);
    await refresh();
    setEditing(null);
    setDraft(EMPTY);
    setSaved(EMPTY);
    flow.setNotice({ text: t("agents.deleted", { name: editing }) });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const kept = keptOf(items.find((i) => i.name === editing));

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-neutral-800">
        <div className="flex flex-col gap-2 border-b border-neutral-800 px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t(L.title)}</span>
          <div className="flex flex-wrap gap-1">
            <button className="btn" onClick={doImport} title={t("import.tip")}>
              {t("import.button")}
            </button>
            <button className="btn" onClick={() => setPicking(true)}>
              {t("gallery.button")}
            </button>
            <button className="btn" onClick={() => select(null)}>
              {t("agents.new")}
            </button>
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 && (
            <li className="space-y-2 px-3 py-3">
              <p className="text-xs text-neutral-600">{t(L.empty)}</p>
              <div className="flex flex-wrap gap-1.5">
                <button className="btn" onClick={doImport} title={t("import.tip")}>
                  {t(cfg.importStart)}
                </button>
                <button className="btn" onClick={() => setPicking(true)}>
                  {t("gallery.startFrom")}
                </button>
              </div>
            </li>
          )}
          {items.map((a) => (
            <li key={a.name}>
              <button
                onClick={() => select(a)}
                className={`block w-full px-3 py-2 text-left ${a.name === editing ? "bg-neutral-800" : "hover:bg-neutral-900"}`}
              >
                <div className="truncate text-[13px] text-neutral-100">{a.name}</div>
                <div className="truncate text-xs text-neutral-500">{a.description}</div>
                <div className="mt-1 flex gap-1">
                  {a.targets.map((x) => (
                    <Badge key={x} className="border-neutral-700 text-neutral-400">
                      {TOOL_LABEL[x]}
                    </Badge>
                  ))}
                </div>
              </button>
            </li>
          ))}
          {kind === "skill" && commands.length > 0 && (
            <li className="border-t border-neutral-800">
              <div className="px-3 pb-1 pt-3">
                <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t("commands.title")}</span>
                <p className="mt-1 text-xs text-neutral-600">{t("commands.intro")}</p>
              </div>
              <ul>
                {commands.map((c) => (
                  <li key={`${c.tool}:${c.name}`} className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[13px] text-neutral-300" title={shortPath(c.path)}>
                        {c.name}
                      </span>
                      <Badge className="border-neutral-700 text-neutral-400">{TOOL_LABEL[c.tool]}</Badge>
                      {!c.verified && (
                        <Badge className="border-rose-800 text-rose-300" title={t("badge.unverifiedTip")}>
                          {t("badge.unverified")}
                        </Badge>
                      )}
                    </div>
                    {c.description && <div className="truncate text-xs text-neutral-500">{c.description}</div>}
                    <div className="mt-1 text-xs">
                      {c.removalPlanned ? (
                        <span className="text-sky-300">{t("commands.removalPlanned")}</span>
                      ) : c.blocked ? (
                        <span className="text-neutral-500">{t(`commands.blocked.${c.blocked}`)}</span>
                      ) : (
                        <button className="btn" onClick={() => startMove(c)}>
                          {t("commands.move")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ul>
        {flow.historyList}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-2.5">
          <h2 className="text-sm font-medium text-neutral-100">{editing ? t("agents.editTitle", { name: editing }) : t(L.newTitle)}</h2>
          <div className="ml-auto">{flow.previewButton(dirty, dirty ? t("agents.saveFirst") : undefined)}</div>
        </div>
        {flow.banners}

        <form
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t("agents.name")} hint={t(L.nameHint)}>
            <input className="input font-mono" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="code-reviewer" />
          </Field>
          <Field label={t("agents.description")} hint={t(L.descriptionHint)}>
            <input className="input" value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder={t(L.descriptionPlaceholder)} />
          </Field>
          <Field label={t("agents.applyTo")}>
            <TargetPicker value={draft.targets} onChange={(v) => set("targets", v)} />
          </Field>
          {kind === "skill" && (
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("skills.invocation")}>
                <label className="flex items-center gap-2 text-sm" title={t("skills.userOnlyTip")}>
                  <input type="checkbox" checked={draft.userOnly} onChange={(e) => set("userOnly", e.target.checked)} />
                  {t("skills.userOnly")}
                </label>
              </Field>
              <Field label={t("skills.argumentHint")} hint={t("skills.argumentHintHint")}>
                <input className="input font-mono" value={draft.argumentHint} onChange={(e) => set("argumentHint", e.target.value)} placeholder="[issue-number]" />
              </Field>
            </div>
          )}
          {kind === "agent" && (
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("agents.model")} hint={t("agents.modelHint")}>
                <input className="input font-mono" value={draft.model} onChange={(e) => set("model", e.target.value)} placeholder="sonnet" />
              </Field>
              <Field label={t("agents.tools")} hint={t("agents.toolsHint")}>
                <input className="input font-mono" value={draft.tools} onChange={(e) => set("tools", e.target.value)} placeholder="Read, Grep, Glob" />
              </Field>
            </div>
          )}
          {kept && (kept.extras.length > 0 || kept.files.length > 0) && (
            <div className="space-y-3">
              {kept.extras.length > 0 && (
                <Field label={t("import.extras")}>
                  <pre className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-400">
                    {kept.extras.join("\n")}
                  </pre>
                </Field>
              )}
              {kept.files.length > 0 && (
                <Field label={t("import.files")}>
                  <pre className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-400">
                    {kept.files.join("\n")}
                  </pre>
                </Field>
              )}
            </div>
          )}
          <Field label={t(L.body)}>
            <textarea
              className="input min-h-[240px] font-mono text-xs leading-relaxed"
              value={draft.body}
              onChange={(e) => set("body", e.target.value)}
              placeholder={t(L.bodyPlaceholder)}
            />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={!dirty}>
              {editing ? t("agents.save") : t(L.create)}
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

      {flow.dialog}
      {moving && <MoveDialog command={moving} shortPath={shortPath} onMove={(remove) => void move(moving, remove)} onClose={() => setMoving(null)} />}
      {picking && <TemplatePicker kind={kind} onPick={pickTemplate} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Confirms moving a command into a skill, and whether to delete the original on the next apply. */
function MoveDialog({
  command: c,
  shortPath,
  onMove,
  onClose,
}: {
  command: LegacyCommand;
  shortPath(path: string): string;
  onMove(removeOriginal: boolean): void;
  onClose(): void;
}) {
  const t = useT();
  const [removeOriginal, setRemoveOriginal] = useState(false);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-medium text-neutral-100">{t("commands.dialogTitle", { name: c.name })}</h3>
        <p className="break-all font-mono text-xs text-neutral-500">{shortPath(c.path)}</p>
        <p className="text-xs text-neutral-400">{t(c.tool === "codex" ? "commands.dialogCodex" : "commands.dialogClaude")}</p>
        {c.tool === "codex" && c.usesArguments && <p className="text-xs text-amber-300">{t("commands.argumentsWarning")}</p>}
        <label className="flex items-start gap-2 text-sm text-neutral-200">
          <input type="checkbox" className="mt-1" checked={removeOriginal} onChange={(e) => setRemoveOriginal(e.target.checked)} />
          <span>
            {t("commands.removeOriginal")}
            <span className="block text-xs text-neutral-500">{t("commands.removeOriginalHint")}</span>
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn" onClick={onClose}>
            {t("action.cancel")}
          </button>
          <button className="btn-primary" onClick={() => onMove(removeOriginal)}>
            {t("commands.move")}
          </button>
        </div>
      </div>
    </div>
  );
}
