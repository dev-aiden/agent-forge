import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@agent-forge/model";
import type { Overview } from "../../shared/api";
import { ItemDetail } from "./components/ItemDetail";
import { ItemList } from "./components/ItemList";
import { makeShortPath } from "./format";

export function App() {
  const [project, setProject] = useState<string | null | undefined>(undefined);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const notified = useRef(false);

  const notifyOnce = (err?: string) => {
    if (notified.current) return;
    notified.current = true;
    window.agentForge.notifyReady(err);
  };

  // Initial project from `--project <dir>`.
  useEffect(() => {
    window.agentForge.getInfo().then(
      (info) => setProject(info.initialProject),
      (e: unknown) => {
        setError(String(e));
        notifyOnce(String(e));
      },
    );
  }, []);

  const load = useCallback(async (p: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const o = await window.agentForge.getOverview(p);
      setOverview(o);
      notifyOnce();
    } catch (e) {
      setError(String(e));
      notifyOnce(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (project !== undefined) void load(project);
  }, [project, load]);

  const visibleTools = useMemo(() => overview?.tools.filter((t) => t.detected) ?? [], [overview]);
  const tool = visibleTools.find((t) => t.id === toolId) ?? visibleTools[0] ?? null;

  const allItems: Item[] = useMemo(() => {
    const c = tool?.config;
    return c ? [...c.rules, ...c.agents, ...c.skills, ...c.mcpServers] : [];
  }, [tool]);
  const selected = allItems.find((i) => i.id === selectedId) ?? null;

  const shortPath = useMemo(
    () => makeShortPath(overview?.home ?? "", overview?.project ?? null),
    [overview],
  );

  async function chooseProject() {
    const dir = await window.agentForge.pickProject();
    if (dir) {
      setSelectedId(null);
      setProject(dir);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-sm text-neutral-200">
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="mr-2 text-base font-semibold tracking-tight text-neutral-100">Agent Forge</h1>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-neutral-800 px-2 py-1">
          <span className="text-xs text-neutral-500">Project</span>
          <span className="truncate font-mono text-xs" title={project ?? undefined}>
            {project ? makeShortPath(overview?.home ?? "", null)(project) : "None (global only)"}
          </span>
        </div>
        <button className="btn" onClick={chooseProject}>
          Choose…
        </button>
        {project && (
          <button className="btn" onClick={() => (setSelectedId(null), setProject(null))}>
            Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {overview && (
            <span className="text-xs text-neutral-500">
              Read {new Date(overview.readAt).toLocaleTimeString()}
            </span>
          )}
          <button className="btn" disabled={loading || project === undefined} onClick={() => project !== undefined && load(project)}>
            {loading ? "Reading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-xs text-red-300">{error}</div>}

      {/* Tool tabs */}
      <nav className="flex gap-1 border-b border-neutral-800 px-3">
        {visibleTools.map((t) => {
          const c = t.config;
          const count = c ? c.rules.length + c.agents.length + c.skills.length + c.mcpServers.length : 0;
          const active = t.id === tool?.id;
          return (
            <button
              key={t.id}
              onClick={() => (setToolId(t.id), setSelectedId(null))}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active ? "border-neutral-200 text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {t.label}
              {t.supported && <span className="ml-1.5 text-xs text-neutral-500">{count}</span>}
            </button>
          );
        })}
      </nav>

      {/* Body */}
      <main className="flex min-h-0 flex-1">
        {!overview ? (
          <Empty>{loading ? "Reading configuration…" : ""}</Empty>
        ) : visibleTools.length === 0 ? (
          <Empty>No supported AI coding CLI was found on this computer.</Empty>
        ) : !tool?.supported || !tool.config ? (
          <Empty>Reading {tool?.label} configuration is not supported yet.</Empty>
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
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center text-neutral-500">{children}</div>;
}
