import type { Item } from "@kitroom/model";
import { SCOPE_STYLE } from "../format";
import { useT } from "../i18n";

export function Badge({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`shrink-0 rounded border px-1.5 py-px text-[10px] leading-4 ${className}`}>
      {children}
    </span>
  );
}

/** Scope plus warnings: unverified location, managed by another app, disabled. */
export function ItemBadges({ item }: { item: Item }) {
  const t = useT();
  const managedBy = "extra" in item ? item.extra.managedBy : undefined;
  return (
    <>
      <Badge className={SCOPE_STYLE[item.source.scope]}>{t(`scope.${item.source.scope}`)}</Badge>
      {!item.source.verified && (
        <Badge className="border-rose-800 text-rose-300" title={t("badge.unverifiedTip")}>
          {t("badge.unverified")}
        </Badge>
      )}
      {typeof managedBy === "string" && (
        <Badge className="border-violet-800 text-violet-300" title={t("badge.managedTip", { by: managedBy })}>
          {managedBy}
        </Badge>
      )}
      {item.kind === "mcp" && !item.enabled && <Badge className="border-neutral-700 text-neutral-400">{t("badge.disabled")}</Badge>}
    </>
  );
}
