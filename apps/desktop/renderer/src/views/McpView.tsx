import { useCallback, useEffect, useState } from "react";
import { WRITABLE_AGENT_TOOLS, type ManagedMcpServer, type McpTransport, type ToolId } from "@kitroom/model";
import { uniqueName, type GalleryTemplate } from "@kitroom/model/gallery";
import { useApplyFlow } from "../apply-flow";
import { Badge } from "../components/Badges";
import { Field, TargetPicker, TOOL_LABEL } from "../components/Form";
import { TemplatePicker } from "../components/TemplatePicker";
import { errorText } from "../format";
import { useLang, useT } from "../i18n";

interface Draft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  targets: ToolId[];
}

const EMPTY: Draft = { name: "", transport: "stdio", command: "", args: "", env: "", url: "", headers: "", targets: [...WRITABLE_AGENT_TOOLS] };

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function parsePairs(s: string): Record<string, string> | undefined {
  const pairs = lines(s).map((l) => {
    const i = l.indexOf("=");
    return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1)];
  });
  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

const pairsText = (r?: Record<string, string>) => Object.entries(r ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");

function toDraft(s: ManagedMcpServer): Draft {
  return {
    name: s.name,
    transport: s.transport,
    command: s.command ?? "",
    args: (s.args ?? []).join("\n"),
    env: pairsText(s.env),
    url: s.url ?? "",
    headers: pairsText(s.headers),
    targets: s.targets,
  };
}

function fromDraft(d: Draft): ManagedMcpServer {
  const stdio = d.transport === "stdio";
  return {
    name: d.name.trim(),
    transport: d.transport,
    command: stdio ? d.command.trim() || undefined : undefined,
    args: stdio && lines(d.args).length ? lines(d.args) : undefined,
    env: stdio ? parsePairs(d.env) : undefined,
    url: stdio ? undefined : d.url.trim() || undefined,
    headers: stdio ? undefined : parsePairs(d.headers),
    targets: d.targets,
  };
}

/** MCP servers managed by Kitroom. Secret values arrive masked and stay masked. */
export function McpView({ shortPath }: { shortPath(path: string): string }) {
  const t = useT();
  const flow = useApplyFlow(shortPath);
  const [servers, setServers] = useState<ManagedMcpServer[] | null | undefined>(undefined);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<Draft>(EMPTY);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const [picking, setPicking] = useState(false);
  const lang = useLang();

  const load = useCallback(async () => setServers(await window.kitroom.listMcp()), []);
  useEffect(() => {
    load().catch((e) => flow.setError(errorText(e)));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  function select(s: ManagedMcpServer | null) {
    if (dirty && !confirm(t("agents.discard"))) return;
    const d = s ? toDraft(s) : EMPTY;
    setEditing(s?.name ?? null);
    setDraft(d);
    setSaved(d);
    flow.setError(null);
  }

  async function doImport() {
    try {
      const r = await window.kitroom.importMcp();
      await load();
      flow.setNotice({
        text: [t("mcp.imported", { n: r.added.length }), r.conflicts.length ? t("mcp.conflicts", { names: r.conflicts.join(", ") }) : ""]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  /** Fills the form with a template as a new, unsaved server. */
  function pickTemplate(tpl: GalleryTemplate) {
    if (tpl.kind !== "mcp") return;
    if (dirty && !confirm(t("agents.discard"))) return;
    const name = uniqueName(tpl.server.name, (servers ?? []).map((s) => s.name));
    setPicking(false);
    setEditing(null);
    setSaved(EMPTY);
    setDraft(toDraft({ ...tpl.server, name, targets: EMPTY.targets }));
    flow.setError(null);
    const title = tpl.title[lang];
    flow.setNotice({ text: [t("gallery.loaded", { title }), name !== tpl.server.name ? t("gallery.renamed", { name }) : ""].filter(Boolean).join(" ") });
  }

  async function save() {
    flow.setError(null);
    try {
      const s = await window.kitroom.saveMcp(fromDraft(draft), editing ?? undefined);
      await load();
      const d = toDraft(s);
      setEditing(s.name);
      setDraft(d);
      setSaved(d);
      flow.setNotice({ text: t("mcp.saved", { name: s.name }) });
    } catch (e) {
      flow.setError(errorText(e));
    }
  }

  async function remove() {
    if (!editing || !confirm(t("mcp.confirmDelete", { name: editing }))) return;
    await window.kitroom.deleteMcp(editing);
    await load();
    setEditing(null);
    setDraft(EMPTY);
    setSaved(EMPTY);
  }

  async function stop() {
    if (!confirm(t("mcp.unmanageConfirm"))) return;
    await window.kitroom.unmanageMcp();
    await load();
    select(null);
  }

  // Read-only; the main process keeps the stored values on save.
  const codexExtra = servers?.find((s) => s.name === editing)?.codexExtra;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  if (servers === undefined) return <div className="flex-1" />;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-neutral-800">
        <div className="flex flex-col gap-2 border-b border-neutral-800 px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t("mcp.title")}</span>
          {servers && (
            <div className="flex flex-wrap gap-1">
              <button className="btn" onClick={doImport} title={t("mcp.reimport")}>
                {t("mcp.reimport")}
              </button>
              <button className="btn" onClick={() => setPicking(true)}>
                {t("gallery.button")}
              </button>
              <button className="btn" onClick={() => select(null)}>
                {t("agents.new")}
              </button>
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {servers === null && <li className="px-4 py-4 text-xs leading-relaxed text-neutral-400">{t("mcp.intro")}</li>}
          {servers?.length === 0 && (
            <li className="space-y-2 px-3 py-3">
              <p className="text-xs text-neutral-600">{t("mcp.empty")}</p>
              <button className="btn" onClick={() => setPicking(true)}>
                {t("gallery.startFrom")}
              </button>
            </li>
          )}
          {servers?.map((s) => (
            <li key={s.name}>
              <button
                onClick={() => select(s)}
                className={`block w-full px-3 py-2 text-left ${s.name === editing ? "bg-neutral-800" : "hover:bg-neutral-900"}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] text-neutral-100">{s.name}</span>
                  <Badge className="border-neutral-700 text-neutral-400">{s.transport}</Badge>
                </div>
                <div className="truncate font-mono text-[11px] text-neutral-500">{s.command ?? s.url}</div>
                <div className="mt-1 flex gap-1">
                  {s.targets.map((x) => (
                    <Badge key={x} className="border-neutral-700 text-neutral-400">
                      {TOOL_LABEL[x]}
                    </Badge>
                  ))}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {flow.historyList}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-neutral-800 px-5 py-2.5">
          <h2 className="text-sm font-medium text-neutral-100">
            {servers === null ? t("mcp.title") : editing ? t("agents.editTitle", { name: editing }) : t("mcp.newTitle")}
          </h2>
          <div className="ml-auto">{servers && flow.previewButton(dirty, dirty ? t("agents.saveFirst") : undefined)}</div>
        </div>
        {flow.banners}

        {servers === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="max-w-xl text-neutral-400">{t("mcp.notManaged")}</p>
            <button className="btn-primary" onClick={doImport}>
              {t("mcp.import")}
            </button>
          </div>
        ) : (
          <form
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid grid-cols-[1fr_200px] gap-4">
              <Field label={t("agents.name")} hint={t("agents.nameHint")}>
                <input className="input font-mono" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="github" />
              </Field>
              <Field label={t("mcp.transport")}>
                <select className="input" value={draft.transport} onChange={(e) => set("transport", e.target.value as McpTransport)}>
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                </select>
              </Field>
            </div>
            <Field label={t("agents.applyTo")}>
              <TargetPicker value={draft.targets} onChange={(v) => set("targets", v)} />
            </Field>
            {codexExtra && (
              <Field label={t("mcp.codexExtra")} hint={t("mcp.codexExtraHint")}>
                <pre className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-400">
                  {Object.entries(codexExtra)
                    .map(([k, v]) => `${k} = ${typeof v === "string" ? v : JSON.stringify(v)}`)
                    .join("\n")}
                </pre>
              </Field>
            )}
            {draft.transport === "stdio" ? (
              <>
                <Field label={t("mcp.command")}>
                  <input className="input font-mono" value={draft.command} onChange={(e) => set("command", e.target.value)} placeholder="npx" />
                </Field>
                <Field label={t("mcp.args")} hint={t("mcp.argsHint")}>
                  <textarea className="input min-h-[80px] font-mono text-xs" value={draft.args} onChange={(e) => set("args", e.target.value)} placeholder={"-y\n@modelcontextprotocol/server-github"} />
                </Field>
                <Field label={t("mcp.env")} hint={`${t("mcp.envHint")} ${t("mcp.secretHint")}`}>
                  <textarea className="input min-h-[80px] font-mono text-xs" value={draft.env} onChange={(e) => set("env", e.target.value)} placeholder="GITHUB_TOKEN=..." />
                </Field>
              </>
            ) : (
              <>
                <Field label={t("mcp.url")}>
                  <input className="input font-mono" value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://example.com/mcp" />
                </Field>
                <Field label={t("mcp.headers")} hint={`${t("mcp.headersHint")} ${t("mcp.secretHint")}`}>
                  <textarea className="input min-h-[80px] font-mono text-xs" value={draft.headers} onChange={(e) => set("headers", e.target.value)} placeholder="Authorization=Bearer ..." />
                </Field>
              </>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={!dirty}>
                {editing ? t("agents.save") : t("mcp.create")}
              </button>
              {editing && (
                <button type="button" className="btn" onClick={remove}>
                  {t("agents.delete")}
                </button>
              )}
              <button type="button" className="btn ml-auto" onClick={stop}>
                {t("mcp.unmanage")}
              </button>
              {dirty && <span className="self-center text-xs text-amber-400">{t("agents.unsaved")}</span>}
            </div>
          </form>
        )}
      </section>

      {flow.dialog}
      {picking && <TemplatePicker kind="mcp" onPick={pickTemplate} onClose={() => setPicking(false)} />}
    </div>
  );
}
