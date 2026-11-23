import { WRITABLE_AGENT_TOOLS, type ToolId } from "@kitroom/model";

export const TOOL_LABEL: Record<ToolId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  copilot: "Copilot CLI",
  antigravity: "Antigravity CLI",
};

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-medium text-neutral-300">{label}</span>
      {hint && <span className="ml-2 text-xs text-neutral-600">{hint}</span>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Checkboxes for the tools Kitroom can write to. */
export function TargetPicker({ value, onChange }: { value: ToolId[]; onChange(v: ToolId[]): void }) {
  return (
    <div className="flex gap-4">
      {WRITABLE_AGENT_TOOLS.map((tool) => (
        <label key={tool} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.includes(tool)}
            onChange={() => onChange(value.includes(tool) ? value.filter((x) => x !== tool) : [...value, tool])}
          />
          {TOOL_LABEL[tool]}
        </label>
      ))}
    </div>
  );
}
