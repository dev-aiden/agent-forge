import { useMemo } from "react";
import { diffLines } from "diff";

/** Line diff of a file. `before` null = new file, `after` null = deleted file. */
export function DiffView({ before, after }: { before: string | null; after: string | null }) {
  const parts = useMemo(() => diffLines(before ?? "", after ?? ""), [before, after]);
  return (
    <pre className="max-h-80 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 py-2 font-mono text-[11px] leading-5">
      {parts.map((part, i) => {
        const lines = part.value.replace(/\n$/, "").split("\n");
        const style = part.added
          ? "bg-emerald-950/60 text-emerald-300"
          : part.removed
            ? "bg-red-950/60 text-red-300"
            : "text-neutral-500";
        const mark = part.added ? "+" : part.removed ? "-" : " ";
        return lines.map((line, j) => (
          <div key={`${i}-${j}`} className={`px-3 ${style}`}>
            <span className="mr-2 select-none opacity-60">{mark}</span>
            {line}
          </div>
        ));
      })}
    </pre>
  );
}
