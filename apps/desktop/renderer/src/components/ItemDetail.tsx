import type { Item } from "@agent-forge/model";
import { useT, type T } from "../i18n";
import { ItemBadges } from "./Badges";

interface Props {
  item: Item | null;
  shortPath(path: string): string;
}

/** Read-only view of one item. */
export function ItemDetail({ item, shortPath }: Props) {
  const t = useT();
  if (!item) {
    return <div className="flex flex-1 items-center justify-center text-neutral-600">{t("detail.select")}</div>;
  }

  const fields = fieldsOf(item, t);
  const body = "body" in item ? item.body : null;

  return (
    <article className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-neutral-800 px-5 py-4">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">{t(`kind.${item.kind}`)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-neutral-100">{item.name}</h2>
          <ItemBadges item={item} />
        </div>
        {item.description && <p className="mt-1 text-neutral-400">{item.description}</p>}
        <p className="mt-2 break-all font-mono text-xs text-neutral-500" title={item.source.path}>
          {shortPath(item.source.path)}
        </p>
      </header>

      {fields.length > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 border-b border-neutral-800 px-5 py-3 text-xs">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-500">{k}</dt>
              <dd className="whitespace-pre-wrap break-all font-mono text-neutral-300">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {body !== null && (
        <pre className="flex-1 whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-relaxed text-neutral-300">
          {body.trim() === "" ? <span className="text-neutral-600">{t("detail.empty")}</span> : body}
        </pre>
      )}
    </article>
  );
}

function record(r?: Record<string, string>): string | undefined {
  if (!r) return undefined;
  return Object.entries(r)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function extra(e: Record<string, unknown>): [string, string][] {
  return Object.entries(e)
    .filter(([k]) => k !== "managedBy")
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
}

function fieldsOf(item: Item, t: T): [string, string][] {
  const rows: [string, string | undefined][] = [];
  switch (item.kind) {
    case "rule":
      rows.push([t("field.root"), item.root ? t("value.yes") : undefined], [t("field.appliesTo"), item.globs?.join(", ")]);
      break;
    case "agent":
      rows.push([t("field.model"), item.model], [t("field.tools"), item.tools?.join(", ")], ...extra(item.extra));
      break;
    case "skill":
      rows.push([t("field.files"), item.files.length ? item.files.join("\n") : undefined], ...extra(item.extra));
      break;
    case "mcp":
      rows.push(
        [t("field.transport"), item.transport],
        [t("field.command"), [item.command, ...(item.args ?? [])].filter(Boolean).join(" ") || undefined],
        [t("field.url"), item.url],
        [t("field.env"), record(item.env)],
        [t("field.headers"), record(item.headers)],
        [t("field.enabled"), item.enabled ? t("value.yes") : t("value.no")],
        ...extra(item.extra),
      );
      break;
  }
  return rows.filter((r): r is [string, string] => r[1] !== undefined && r[1] !== "");
}
