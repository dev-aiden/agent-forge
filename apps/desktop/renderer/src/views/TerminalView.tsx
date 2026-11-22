import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { LaunchTarget, ToolOverview } from "../../../shared/api";
import { errorText } from "../format";
import { useT } from "../i18n";

// One listener per channel for the whole app; output is routed to tabs by session id.
// Output that arrives before a tab registers (right after spawn) is buffered.
const handlers = new Map<number, (data: string) => void>();
const pending = new Map<number, string[]>();
const exitHandlers = new Map<number, (code: number) => void>();
let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;
  window.agentForge.onTermData((id, data) => {
    const h = handlers.get(id);
    if (h) h(data);
    else pending.set(id, [...(pending.get(id) ?? []), data]);
  });
  window.agentForge.onTermExit((id, code) => exitHandlers.get(id)?.(code));
}

interface Tab {
  key: number;
  target: LaunchTarget;
  label: string;
}

interface Props {
  tools: ToolOverview[];
  visible: boolean;
  shortPath(path: string): string;
}

let tabSeq = 1;

export function TerminalView({ tools, visible, shortPath }: Props) {
  const t = useT();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);

  useEffect(wireOnce, []);

  const targets: { target: LaunchTarget; label: string; available: boolean }[] = [
    ...tools.map((tool) => ({ target: tool.id as LaunchTarget, label: tool.label, available: Boolean(tool.binary) })),
    { target: "shell", label: t("term.shell"), available: true },
  ];

  function open(target: LaunchTarget, label: string) {
    const tab = { key: tabSeq++, target, label };
    setTabs((list) => [...list, tab]);
    setActive(tab.key);
  }

  function close(key: number) {
    setTabs((list) => {
      const next = list.filter((x) => x.key !== key);
      if (active === key) setActive(next.at(-1)?.key ?? null);
      return next;
    });
  }

  return (
    <div className={`min-h-0 flex-1 flex-col ${visible ? "flex" : "hidden"}`}>
      <div className="flex items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-xs ${
              tab.key === active ? "bg-neutral-800 text-neutral-100" : "text-neutral-500 hover:bg-neutral-900"
            }`}
          >
            <button onClick={() => setActive(tab.key)}>{tab.label}</button>
            <button className="text-neutral-500 hover:text-neutral-200" title={t("action.close")} onClick={() => close(tab.key)}>
              ×
            </button>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-xs text-neutral-600">{t("term.new")}:</span>
          {targets.map((x) => (
            <button
              key={x.target}
              className="btn"
              disabled={!x.available}
              title={x.available ? undefined : t("term.notFound")}
              onClick={() => open(x.target, x.label)}
            >
              + {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center px-8 text-center text-neutral-500">{t("term.empty")}</div>
        )}
        {tabs.map((tab) => (
          <TerminalPane key={tab.key} target={tab.target} visible={visible && tab.key === active} shortPath={shortPath} />
        ))}
      </div>
    </div>
  );
}

function TerminalPane({ target, visible, shortPath }: { target: LaunchTarget; visible: boolean; shortPath(p: string): string }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);

  useEffect(() => {
    const term = new Terminal({
      // Nerd / Powerline fonts first so shell prompt icons render, D2Coding for Korean,
      // then system monospace fonts. Fonts that are not installed are skipped.
      fontFamily:
        '"MesloLGS NF", "JetBrainsMono Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", D2Coding, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: "#0a0a0a", foreground: "#e5e5e5", cursor: "#e5e5e5", selectionBackground: "#404040" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // not laid out yet
    }

    let sessionId: number | null = null;
    let disposed = false;

    window.agentForge.termSpawn(target, term.cols, term.rows).then(
      (session) => {
        if (disposed) {
          window.agentForge.termKill(session.id);
          return;
        }
        sessionId = session.id;
        setCwd(session.cwd);
        handlers.set(session.id, (data) => term.write(data));
        exitHandlers.set(session.id, (code) => term.write(`\r\n\x1b[90m${t("term.exited", { code })}\x1b[0m\r\n`));
        for (const chunk of pending.get(session.id) ?? []) term.write(chunk);
        pending.delete(session.id);
        term.focus();
      },
      (e) => term.write(`\x1b[31m${t("term.failed", { error: errorText(e) })}\x1b[0m\r\n`),
    );

    const input = term.onData((data) => {
      if (sessionId !== null) window.agentForge.termWrite(sessionId, data);
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (sessionId !== null) window.agentForge.termResize(sessionId, cols, rows);
    });
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent !== null) {
        try {
          fit.fit();
        } catch {
          // ignore while hidden
        }
      }
    });
    observer.observe(host.current!);

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resize.dispose();
      if (sessionId !== null) {
        window.agentForge.termKill(sessionId);
        handlers.delete(sessionId);
        exitHandlers.delete(sessionId);
      }
      term.dispose();
    };
    // Each pane owns one session for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit when the tab becomes visible.
  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit());
  }, [visible]);

  return (
    <div className={`absolute inset-0 flex-col ${visible ? "flex" : "hidden"}`}>
      <div ref={host} className="min-h-0 flex-1 px-2 pt-2" />
      {cwd && <div className="border-t border-neutral-900 px-3 py-1 font-mono text-[11px] text-neutral-600">{t("term.cwd", { dir: shortPath(cwd) })}</div>}
    </div>
  );
}
