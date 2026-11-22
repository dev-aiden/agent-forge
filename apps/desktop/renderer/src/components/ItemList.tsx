import { useMemo, useState } from "react";
import type { Item, ToolConfig } from "@agent-forge/model";
import { useT } from "../i18n";
import { ItemBadges } from "./Badges";

const SECTIONS = [
  { key: "rules", title: "section.rules" },
  { key: "agents", title: "section.agents" },
  { key: "skills", title: "section.skills" },
  { key: "mcpServers", title: "section.mcp" },
] as const;

interface Props {
  config: ToolConfig;
  binary: string | null;
  selectedId: string | null;
  onSelect(id: string): void;
  shortPath(path: string): string;
}

export function ItemList({ config, binary, selectedId, onSelect, shortPath }: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => {
        const items: Item[] = config[s.key];
        const shown = q
          ? items.filter((i) => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q))
          : items;
        return { ...s, total: items.length, shown };
      }),
    [config, q],
  );

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-r border-neutral-800">
      <div className="border-b border-neutral-800 p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("list.filter")}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections.map((s) => (
          <section key={s.key} className="border-b border-neutral-900">
            <h2 className="sticky top-0 flex items-center justify-between bg-neutral-950/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              {t(s.title)}
              <span>{q ? `${s.shown.length}/${s.total}` : s.total}</span>
            </h2>
            {s.shown.length === 0 ? (
              <p className="px-3 pb-2 text-xs text-neutral-600">{s.total === 0 ? t("list.none") : t("list.noMatch")}</p>
            ) : (
              <ul>
                {s.shown.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() => onSelect(item.id)}
                      className={`block w-full px-3 py-1.5 text-left ${
                        item.id === selectedId ? "bg-neutral-800" : "hover:bg-neutral-900"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] text-neutral-100">{item.name}</span>
                        <ItemBadges item={item} />
                      </div>
                      {item.description && <p className="truncate text-xs text-neutral-500">{item.description}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {config.issues.length > 0 && (
          <section className="px-3 py-2">
            <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-500">{t("list.problems")}</h2>
            <ul className="space-y-1">
              {config.issues.map((i, n) => (
                <li key={n} className="text-xs text-amber-300/80">
                  <span className="font-mono">{shortPath(i.path)}</span> — {i.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="border-t border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-600">
        {t("list.cli")}: <span className="font-mono">{binary ? shortPath(binary) : t("list.notOnPath")}</span>
      </footer>
    </aside>
  );
}
