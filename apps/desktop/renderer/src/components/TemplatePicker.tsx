import { useEffect, useState } from "react";
import type { GalleryKind, GalleryTemplate } from "@agent-forge/model/gallery";
import { templatesOf } from "../gallery";
import { useLang, useT } from "../i18n";

interface Props<K extends GalleryKind> {
  kind: K;
  onPick(template: Extract<GalleryTemplate, { kind: K }>): void;
  onClose(): void;
}

/** What the template will put into the form, shown before picking. */
function previewText(t: GalleryTemplate): string {
  switch (t.kind) {
    case "agent": {
      const a = t.agent;
      const head = [`name: ${a.name}`, `description: ${a.description}`, a.model && `model: ${a.model}`, a.tools?.length && `tools: ${a.tools.join(", ")}`];
      return `${head.filter(Boolean).join("\n")}\n\n${a.body}`;
    }
    case "skill":
      return `name: ${t.skill.name}\ndescription: ${t.skill.description}\n\n${t.skill.body}`;
    case "rule":
      return t.body;
    case "mcp":
      return `${JSON.stringify(t.server, null, 2)}\n`;
  }
}

/** Lists the bundled starter templates of one kind. Picking only fills the form. */
export function TemplatePicker<K extends GalleryKind>({ kind, onPick, onClose }: Props<K>) {
  const t = useT();
  const lang = useLang();
  const list = templatesOf(kind);
  const [selected, setSelected] = useState(list[0]?.id);
  const current = list.find((x) => x.id === selected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/75 p-8 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="flex h-full max-h-[640px] w-full max-w-4xl flex-col rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">{t(`gallery.title.${kind}`)}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{t(kind === "rule" ? "gallery.introRule" : "gallery.intro")}</p>
          </div>
          <button className="btn ml-auto" onClick={onClose}>
            {t("action.close")}
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <ul className="w-[280px] shrink-0 overflow-y-auto border-r border-neutral-800">
            {list.map((x) => (
              <li key={x.id}>
                <button
                  onClick={() => setSelected(x.id)}
                  onDoubleClick={() => onPick(x)}
                  className={`block w-full px-4 py-2.5 text-left ${x.id === selected ? "bg-neutral-800" : "hover:bg-neutral-950/40"}`}
                >
                  <div className="text-[13px] text-neutral-100">{x.title[lang]}</div>
                  <div className="mt-0.5 text-xs leading-snug text-neutral-500">{x.summary[lang]}</div>
                </button>
              </li>
            ))}
          </ul>

          {current && (
            <div className="flex min-w-0 flex-1 flex-col">
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-neutral-300">
                {previewText(current)}
              </pre>
              <footer className="flex justify-end border-t border-neutral-800 px-5 py-3">
                <button className="btn-primary" onClick={() => onPick(current)}>
                  {t(kind === "rule" ? "gallery.append" : "gallery.use")}
                </button>
              </footer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
