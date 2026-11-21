import { useEffect, useRef, useState } from "react";
import type { AppInfo } from "../../shared/api";

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notified = useRef(false);

  useEffect(() => {
    window.agentForge.getInfo().then(setInfo, (e: unknown) => setError(String(e)));
  }, []);

  // Tell the main process the UI rendered real data (used by --smoke-test).
  useEffect(() => {
    if (info && !notified.current) {
      notified.current = true;
      window.agentForge.notifyReady();
    }
  }, [info]);

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 bg-neutral-950 text-neutral-100">
      <h1 className="text-3xl font-semibold tracking-tight">Agent Forge</h1>
      <p className="text-sm text-neutral-400">
        Build agents, skills, rules and MCP settings once — apply them to every AI coding CLI.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {info && (
        <dl
          data-testid="app-info"
          className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-800 px-6 py-4 font-mono text-xs"
        >
          <dt className="text-neutral-500">version</dt>
          <dd>{info.version}</dd>
          <dt className="text-neutral-500">platform</dt>
          <dd>
            {info.platform} / {info.arch}
          </dd>
          <dt className="text-neutral-500">electron</dt>
          <dd>{info.electron}</dd>
          <dt className="text-neutral-500">node</dt>
          <dd>{info.node}</dd>
          <dt className="text-neutral-500">chrome</dt>
          <dd>{info.chrome}</dd>
        </dl>
      )}
    </main>
  );
}
