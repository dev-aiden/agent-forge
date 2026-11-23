import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { TERMINAL_FONT_SIZE, type LaunchTarget, type ToolOverview } from "../../../shared/api";
import { errorText } from "../format";
import { useT } from "../i18n";
import { useTheme, type ResolvedTheme } from "../theme";

const XTERM_THEME: Record<ResolvedTheme, ITheme> = {
  dark: { background: "#0a0a0a", foreground: "#e5e5e5", cursor: "#e5e5e5", selectionBackground: "#4a4a4a" },
  light: {
    background: "#ffffff",
    foreground: "#1f1f1f",
    cursor: "#1f1f1f",
    selectionBackground: "#c7d7f0",
    // Bright ANSI colors are hard to read on white: use the darker variants.
    black: "#1f1f1f",
    red: "#b42318",
    green: "#067647",
    yellow: "#8a5a00",
    blue: "#1d4ed8",
    magenta: "#9333ea",
    cyan: "#0e7490",
    white: "#6b6b6b",
    brightBlack: "#595959",
    brightRed: "#c2410c",
    brightGreen: "#15803d",
    brightYellow: "#a16207",
    brightBlue: "#2563eb",
    brightMagenta: "#a21caf",
    brightCyan: "#0891b2",
    brightWhite: "#3f3f3f",
  },
};

const isMac = navigator.platform.toLowerCase().includes("mac");

// One listener per channel for the whole app; output is routed to tabs by session id.
// Output that arrives before a tab registers (right after spawn) is buffered.
const handlers = new Map<number, (data: string) => void>();
const pending = new Map<number, string[]>();
const exitHandlers = new Map<number, (code: number) => void>();
let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;
  window.kitroom.onTermData((id, data) => {
    const h = handlers.get(id);
    if (h) h(data);
    else pending.set(id, [...(pending.get(id) ?? []), data]);
  });
  window.kitroom.onTermExit((id, code) => exitHandlers.get(id)?.(code));
}

interface Tab {
  key: number;
  target: LaunchTarget;
  label: string;
  /** Bumped by "Run again": remounts the pane with a fresh session. */
  run: number;
}

interface Props {
  tools: ToolOverview[];
  visible: boolean;
  shortPath(path: string): string;
  fontSize: number;
  onFontSize(size: number): void;
}

let tabSeq = 1;

export function TerminalView({ tools, visible, shortPath, fontSize, onFontSize }: Props) {
  const t = useT();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);

  useEffect(wireOnce, []);

  const targets: { target: LaunchTarget; label: string; available: boolean }[] = [
    ...tools.map((tool) => ({ target: tool.id as LaunchTarget, label: tool.label, available: Boolean(tool.binary) })),
    { target: "shell", label: t("term.shell"), available: true },
  ];

  function open(target: LaunchTarget, label: string) {
    const tab = { key: tabSeq++, target, label, run: 0 };
    setTabs((list) => [...list, tab]);
    setActive(tab.key);
  }

  const restart = (key: number) => setTabs((list) => list.map((x) => (x.key === key ? { ...x, run: x.run + 1 } : x)));

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
          <TerminalPane
            key={`${tab.key}-${tab.run}`}
            target={tab.target}
            visible={visible && tab.key === active}
            shortPath={shortPath}
            fontSize={fontSize}
            onFontSize={onFontSize}
            onRestart={() => restart(tab.key)}
          />
        ))}
      </div>
    </div>
  );
}

interface PaneProps {
  target: LaunchTarget;
  visible: boolean;
  shortPath(p: string): string;
  fontSize: number;
  onFontSize(size: number): void;
  onRestart(): void;
}

const clampFont = (n: number) => Math.min(TERMINAL_FONT_SIZE.max, Math.max(TERMINAL_FONT_SIZE.min, n));

function TerminalPane({ target, visible, shortPath, fontSize, onFontSize, onRestart }: PaneProps) {
  const t = useT();
  const theme = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  // Latest values for the key handler, which is installed once.
  const fontRef = useRef({ fontSize, onFontSize });
  fontRef.current = { fontSize, onFontSize };
  const [cwd, setCwd] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const refit = () => {
    try {
      fitRef.current?.fit();
    } catch {
      // not laid out / hidden
    }
  };

  useEffect(() => {
    const term = new Terminal({
      // Nerd / Powerline fonts first so shell prompt icons render, D2Coding for Korean,
      // then system monospace fonts. Fonts that are not installed are skipped.
      fontFamily:
        '"MesloLGS NF", "JetBrainsMono Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", D2Coding, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize,
      cursorBlink: true,
      allowProposedApi: true, // search decorations
      theme: XTERM_THEME[theme],
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    // Links open in the default browser through the main process (http/https only).
    term.loadAddon(new WebLinksAddon((event, uri) => {
      event.preventDefault();
      window.kitroom.openExternal(uri);
    }));
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    refit();

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      // Font size: Cmd/Ctrl + = / - / 0
      if (mod && !e.altKey && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        const { fontSize: cur, onFontSize: set } = fontRef.current;
        set(e.key === "0" ? TERMINAL_FONT_SIZE.default : clampFont(cur + (e.key === "-" ? -1 : 1)));
        e.preventDefault();
        return false;
      }
      // Search: Cmd/Ctrl + F
      if (mod && !e.altKey && e.key.toLowerCase() === "f") {
        setSearching(true);
        requestAnimationFrame(() => searchInput.current?.select());
        e.preventDefault();
        return false;
      }
      // Windows / Linux: Ctrl+Shift+C / V copy and paste (plain Ctrl+C stays an interrupt).
      if (!isMac && e.ctrlKey && e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "c") {
          const sel = term.getSelection();
          if (sel) window.kitroom.clipboardWrite(sel);
          e.preventDefault();
          return false;
        }
        if (k === "v") {
          void window.kitroom.clipboardRead().then((text) => text && term.paste(text));
          e.preventDefault();
          return false;
        }
      }
      return true;
    });

    let sessionId: number | null = null;
    let disposed = false;

    window.kitroom.termSpawn(target, term.cols, term.rows).then(
      (session) => {
        if (disposed) {
          window.kitroom.termKill(session.id);
          return;
        }
        sessionId = session.id;
        setCwd(session.cwd);
        handlers.set(session.id, (data) => term.write(data));
        exitHandlers.set(session.id, (code) => {
          term.write(`\r\n\x1b[90m${t("term.exited", { code })}\x1b[0m\r\n`);
          setExitCode(code);
        });
        for (const chunk of pending.get(session.id) ?? []) term.write(chunk);
        pending.delete(session.id);
        term.focus();
      },
      (e) => {
        term.write(`\x1b[31m${t("term.failed", { error: errorText(e) })}\x1b[0m\r\n`);
        setExitCode(-1);
      },
    );

    const input = term.onData((data) => {
      if (sessionId !== null) window.kitroom.termWrite(sessionId, data);
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (sessionId !== null) window.kitroom.termResize(sessionId, cols, rows);
    });
    const observer = new ResizeObserver(() => {
      if (host.current?.offsetParent !== null) refit();
    });
    observer.observe(host.current!);

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resize.dispose();
      if (sessionId !== null) {
        window.kitroom.termKill(sessionId);
        handlers.delete(sessionId);
        exitHandlers.delete(sessionId);
      }
      term.dispose();
      termRef.current = null;
    };
    // Each pane owns one session for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live theme and font size changes.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = XTERM_THEME[theme];
  }, [theme]);
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontSize = fontSize;
    refit();
  }, [fontSize]);

  // Re-fit when the tab becomes visible.
  useEffect(() => {
    if (visible) requestAnimationFrame(refit);
  }, [visible]);

  const find = (back = false) => {
    if (!query) return;
    const opts = { decorations: { matchOverviewRuler: "#888888", activeMatchColorOverviewRuler: "#f59e0b", activeMatchBackground: "#f59e0b" } };
    if (back) searchRef.current?.findPrevious(query, opts);
    else searchRef.current?.findNext(query, opts);
  };
  const closeSearch = () => {
    setSearching(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <div className={`absolute inset-0 flex-col ${visible ? "flex" : "hidden"}`}>
      {searching && (
        <div className="absolute right-4 top-3 z-10 flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-lg">
          <input
            ref={searchInput}
            className="input w-56 py-1 text-xs"
            value={query}
            placeholder={t("term.search")}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") find(e.shiftKey);
              if (e.key === "Escape") closeSearch();
            }}
          />
          <button className="btn" title={t("term.searchPrev")} onClick={() => find(true)}>
            ↑
          </button>
          <button className="btn" title={t("term.searchNext")} onClick={() => find()}>
            ↓
          </button>
          <button className="btn" title={t("action.close")} onClick={closeSearch}>
            ×
          </button>
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 px-2 pt-2" />
      <div className="flex items-center gap-3 border-t border-neutral-800 px-3 py-1 text-[11px] text-neutral-500">
        {cwd && <span className="font-mono">{t("term.cwd", { dir: shortPath(cwd) })}</span>}
        {exitCode !== null && (
          <button className="btn py-0.5" onClick={onRestart}>
            {t("term.restart")}
          </button>
        )}
        <span className="ml-auto">{t("term.keys", { mod: isMac ? "⌘" : "Ctrl" })}</span>
      </div>
    </div>
  );
}
