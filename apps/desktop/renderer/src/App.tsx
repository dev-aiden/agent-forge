import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@kitroom/model";
import type { AppSettings, Overview, UpdateInfo, WriteScope } from "../../shared/api";
import { ItemDetail } from "./components/ItemDetail";
import { ItemList } from "./components/ItemList";
import { SettingsDialog } from "./components/SettingsDialog";
import { errorText, makeShortPath } from "./format";
import { I18nProvider, resolveLanguage, useLang, useT } from "./i18n";
import { ThemeProvider, useResolvedTheme } from "./theme";
import { ManagedView } from "./views/ManagedView";
import { McpView } from "./views/McpView";
import { RulesView } from "./views/RulesView";
import { TerminalView } from "./views/TerminalView";

type View = "overview" | "agents" | "skills" | "rules" | "mcp" | "terminal";

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.kitroom.getSettings().then(setSettings, () => setSettings({ language: "system", theme: "system", terminalFontSize: 13, disabledTools: [], checkUpdates: true }));
  }, []);

  const theme = useResolvedTheme(settings?.theme ?? "system");

  if (!settings) return null;
  return (
    <I18nProvider lang={resolveLanguage(settings.language)}>
      <ThemeProvider value={theme}>
        <Main
          settings={settings}
          onSettings={(next) => {
            setSettings(next);
            void window.kitroom.saveSettings(next).then(setSettings);
          }}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

function Main({ settings, onSettings }: { settings: AppSettings; onSettings(s: AppSettings): void }) {
  const t = useT();
  const lang = useLang();
  const [project, setProject] = useState<string | null | undefined>(undefined);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoUpdatedAt, setAutoUpdatedAt] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [showSettings, setShowSettings] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // Once per launch, and when the setting is turned on.
  useEffect(() => {
    if (!settings.checkUpdates) return;
    let live = true;
    window.kitroom.checkForUpdate().then((u) => live && setUpdate(u), () => {});
    return () => {
      live = false;
    };
  }, [settings.checkUpdates]);
  /** Where managed items are written; confirmed by the main process before views load. */
  const [scope, setScope] = useState<WriteScope>("global");
  const notified = useRef(false);
  const projectRef = useRef<string | null | undefined>(undefined);
  projectRef.current = project;

  const notifyOnce = (err?: string) => {
    if (notified.current) return;
    notified.current = true;
    window.kitroom.notifyReady(err);
  };

  // Initial project from `--project <dir>`.
  useEffect(() => {
    window.kitroom.getInfo().then(
      (info) => setProject(info.initialProject),
      (e: unknown) => {
        setError(errorText(e));
        notifyOnce(errorText(e));
      },
    );
  }, []);

  const load = useCallback(async (p: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await window.kitroom.getOverview(p));
      notifyOnce();
    } catch (e) {
      setError(errorText(e));
      notifyOnce(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (project !== undefined) void load(project);
  }, [project, load]);

  // Live updates pushed by the main process when config files change on disk.
  useEffect(
    () =>
      window.kitroom.onOverviewChanged((o) => {
        if (o.project !== (projectRef.current ?? null)) return;
        setOverview(o);
        setAutoUpdatedAt(o.readAt);
      }),
    [],
  );

  const detectedTools = useMemo(() => overview?.tools.filter((x) => x.detected) ?? [], [overview]);
  const visibleTools = useMemo(
    () => detectedTools.filter((x) => !settings.disabledTools.includes(x.id)),
    [detectedTools, settings.disabledTools],
  );
  const tool = visibleTools.find((x) => x.id === toolId) ?? visibleTools[0] ?? null;

  const allItems: Item[] = useMemo(() => {
    const c = tool?.config;
    return c ? [...c.rules, ...c.agents, ...c.skills, ...c.commands, ...c.mcpServers] : [];
  }, [tool]);
  const selected = allItems.find((i) => i.id === selectedId) ?? null;

  const shortPath = useMemo(() => makeShortPath(overview?.home ?? "", overview?.project ?? null), [overview]);
  const homePath = useMemo(() => makeShortPath(overview?.home ?? "", null), [overview]);

  async function changeScope(next: WriteScope) {
    try {
      setScope(await window.kitroom.setWriteScope(next));
    } catch (e) {
      setError(errorText(e));
    }
  }

  // Without a project, only the global scope exists.
  useEffect(() => {
    if (project === null && scope === "project") void changeScope("global");
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chooseProject() {
    const dir = await window.kitroom.pickProject();
    if (dir) {
      setSelectedId(null);
      setProject(dir);
    }
  }

  const views: View[] = ["overview", "agents", "skills", "rules", "mcp", "terminal"];
  const timeText = overview ? new Date(overview.readAt).toLocaleTimeString(lang) : "";

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-sm text-neutral-200">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="mr-2 text-base font-semibold tracking-tight text-neutral-100">Kitroom</h1>
        <div className="flex rounded-md border border-neutral-800 p-0.5">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-2.5 py-0.5 text-xs ${view === v ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              {t(`nav.${v}`)}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-800 px-2 py-1">
          <span className="shrink-0 text-xs text-neutral-500">{t("project.label")}</span>
          <span className="truncate font-mono text-xs" title={project ?? undefined}>
            {project ? homePath(project) : t("project.none")}
          </span>
        </div>
        <button className="btn shrink-0" onClick={chooseProject}>
          {t("project.choose")}
        </button>
        {project && (
          <button className="btn shrink-0" onClick={() => (setSelectedId(null), setProject(null))}>
            {t("project.clear")}
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {overview && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500" title={t("status.watching")}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {autoUpdatedAt === overview.readAt ? t("status.updated", { time: timeText }) : t("status.read", { time: timeText })}
            </span>
          )}
          <button className="btn" disabled={loading || project === undefined} onClick={() => project !== undefined && load(project)}>
            {loading ? t("action.reading") : t("action.refresh")}
          </button>
          <button className="btn" onClick={() => setShowSettings(true)}>
            {t("nav.settings")}
          </button>
        </div>
      </header>

      {update && (
        <div className="flex items-center gap-3 border-b border-sky-800 bg-sky-950/40 px-4 py-2 text-xs text-sky-300">
          <span>{t("update.available", { version: update.version })}</span>
          <button className="hover:underline" onClick={() => window.kitroom.openExternal(update.url)}>
            {t("update.open")}
          </button>
          <button className="ml-auto text-neutral-500 hover:text-neutral-300" onClick={() => setUpdate(null)}>
            {t("action.dismiss")}
          </button>
        </div>
      )}
      {error && <div className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-xs text-red-300">{error}</div>}

      {(view === "agents" || view === "skills" || view === "rules" || view === "mcp") && (
        <ScopeBar scope={scope} project={project ?? null} shortPath={homePath} onChange={changeScope} />
      )}
      {/* Keyed by scope and project so each one loads its own list. */}
      {view === "agents" && <ManagedView key={`agent-${scope}-${project}`} kind="agent" shortPath={homePath} />}
      {view === "skills" && <ManagedView key={`skill-${scope}-${project}`} kind="skill" shortPath={homePath} />}
      {view === "rules" && <RulesView key={`rules-${scope}-${project}`} shortPath={homePath} />}
      {view === "mcp" && <McpView key={`mcp-${scope}-${project}`} shortPath={homePath} />}

      {/* Kept mounted so running CLIs survive switching views. */}
      <TerminalView
        tools={visibleTools}
        visible={view === "terminal"}
        shortPath={homePath}
        fontSize={settings.terminalFontSize}
        onFontSize={(terminalFontSize) => onSettings({ ...settings, terminalFontSize })}
      />

      {view === "overview" && (
        <>
          <nav className="flex gap-1 border-b border-neutral-800 px-3">
            {visibleTools.map((x) => {
              const c = x.config;
              const count = c ? c.rules.length + c.agents.length + c.skills.length + c.commands.length + c.mcpServers.length : 0;
              const active = x.id === tool?.id;
              return (
                <button
                  key={x.id}
                  onClick={() => (setToolId(x.id), setSelectedId(null))}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    active ? "border-neutral-200 text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {x.label}
                  {x.supported && <span className="ml-1.5 text-xs text-neutral-500">{count}</span>}
                </button>
              );
            })}
          </nav>

          <main className="flex min-h-0 flex-1">
            {!overview ? (
              <Empty>{loading ? t("overview.loading") : ""}</Empty>
            ) : detectedTools.length === 0 ? (
              <Empty>{t("overview.noTools")}</Empty>
            ) : visibleTools.length === 0 ? (
              <Empty>{t("overview.allDisabled")}</Empty>
            ) : !tool?.supported || !tool.config ? (
              <Empty>{t("overview.unsupported", { tool: tool?.label ?? "" })}</Empty>
            ) : (
              <>
                <ItemList
                  config={tool.config}
                  binary={tool.binary}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                  shortPath={shortPath}
                />
                <ItemDetail item={selected} shortPath={shortPath} />
              </>
            )}
          </main>
        </>
      )}

      {showSettings && overview && (
        <SettingsDialog settings={settings} tools={overview.tools} onChange={onSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-neutral-500">{children}</div>;
}

/** Chooses whether managed items go to the user's global config or the selected project. */
function ScopeBar({
  scope,
  project,
  shortPath,
  onChange,
}: {
  scope: WriteScope;
  project: string | null;
  shortPath(path: string): string;
  onChange(scope: WriteScope): void;
}) {
  const t = useT();
  const option = (value: WriteScope, label: string, disabled = false) => (
    <button
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`rounded px-2.5 py-0.5 text-xs disabled:opacity-40 ${
        scope === value ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900/60 px-4 py-1.5">
      <span className="text-xs text-neutral-400">{t("writeScope.label")}</span>
      <div className="flex rounded-md border border-neutral-800 p-0.5">
        {option("global", t("writeScope.global"))}
        {option("project", project ? t("writeScope.project", { name: shortPath(project) }) : t("writeScope.projectNone"), !project)}
      </div>
      <span className="truncate text-xs text-neutral-500">
        {scope === "project" ? t("writeScope.projectNote") : project ? t("writeScope.globalNote") : t("writeScope.pickHint")}
      </span>
    </div>
  );
}
