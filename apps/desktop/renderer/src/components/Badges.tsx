import type { Item } from "@agent-forge/model";
import { SCOPE_STYLE } from "../format";

export function Badge({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`shrink-0 rounded border px-1.5 py-px text-[10px] leading-4 ${className}`}>
      {children}
    </span>
  );
}

/** Scope plus warnings: unverified location, managed by another app, disabled. */
export function ItemBadges({ item }: { item: Item }) {
  const managedBy = "extra" in item ? item.extra.managedBy : undefined;
  return (
    <>
      <Badge className={SCOPE_STYLE[item.source.scope]}>{item.source.scope}</Badge>
      {!item.source.verified && (
        <Badge className="border-rose-800 text-rose-300" title="This location is not confirmed by the tool's documentation yet.">
          unverified path
        </Badge>
      )}
      {typeof managedBy === "string" && (
        <Badge className="border-violet-800 text-violet-300" title={`Managed by ${managedBy}. Agent Forge will not edit it.`}>
          {managedBy}
        </Badge>
      )}
      {item.kind === "mcp" && !item.enabled && <Badge className="border-neutral-700 text-neutral-400">disabled</Badge>}
    </>
  );
}
