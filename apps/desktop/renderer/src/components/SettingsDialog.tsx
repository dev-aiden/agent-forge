import { TOOL_IDS, type ToolId } from "@kitroom/model";
import type { AppSettings, Language, Theme, ToolOverview } from "../../../shared/api";
import { useT } from "../i18n";

const TOOL_LABEL: Record<ToolId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  copilot: "Copilot CLI",
  antigravity: "Antigravity CLI",
};

interface Props {
  settings: AppSettings;
  tools: ToolOverview[];
  onChange(settings: AppSettings): void;
  onClose(): void;
}

export function SettingsDialog({ settings, tools, onChange, onClose }: Props) {
  const t = useT();
  const languages: { value: Language; label: string }[] = [
    { value: "system", label: t("settings.language.system") },
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
  ];

  const themes: { value: Theme; label: string }[] = [
    { value: "system", label: t("settings.theme.system") },
    { value: "light", label: t("settings.theme.light") },
    { value: "dark", label: t("settings.theme.dark") },
  ];

  const toggleTool = (id: ToolId) => {
    const off = settings.disabledTools.includes(id);
    onChange({
      ...settings,
      disabledTools: off ? settings.disabledTools.filter((x) => x !== id) : [...settings.disabledTools, id],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/75 backdrop-blur-[1px] p-8" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center border-b border-neutral-800 px-5 py-3">
          <h2 className="text-base font-semibold text-neutral-100">{t("settings.title")}</h2>
          <button className="btn ml-auto" onClick={onClose}>
            {t("action.close")}
          </button>
        </header>

        <section className="space-y-2 px-5 py-4">
          <h3 className="text-xs font-medium text-neutral-300">{t("settings.language")}</h3>
          <div className="flex gap-4">
            {languages.map((l) => (
              <label key={l.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="language"
                  checked={settings.language === l.value}
                  onChange={() => onChange({ ...settings, language: l.value })}
                />
                {l.label}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2 border-t border-neutral-800 px-5 py-4">
          <h3 className="text-xs font-medium text-neutral-300">{t("settings.theme")}</h3>
          <div className="flex gap-4">
            {themes.map((th) => (
              <label key={th.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="theme"
                  checked={settings.theme === th.value}
                  onChange={() => onChange({ ...settings, theme: th.value })}
                />
                {th.label}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2 border-t border-neutral-800 px-5 py-4">
          <h3 className="text-xs font-medium text-neutral-300">{t("settings.tools")}</h3>
          <p className="text-xs text-neutral-500">{t("settings.toolsHint")}</p>
          <ul className="space-y-1.5">
            {TOOL_IDS.map((id) => {
              const detected = tools.find((x) => x.id === id)?.detected ?? false;
              return (
                <li key={id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!settings.disabledTools.includes(id)} onChange={() => toggleTool(id)} />
                    {TOOL_LABEL[id]}
                    <span className={`text-xs ${detected ? "text-emerald-400" : "text-neutral-600"}`}>
                      {detected ? t("settings.detected") : t("settings.notDetected")}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-1.5 border-t border-neutral-800 px-5 py-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.checkUpdates} onChange={(e) => onChange({ ...settings, checkUpdates: e.target.checked })} />
            {t("settings.checkUpdates")}
          </label>
          <p className="text-xs text-neutral-500">{t("settings.checkUpdatesHint")}</p>
        </section>

        <footer className="border-t border-neutral-800 px-5 py-3 text-xs text-neutral-600">{t("settings.storage")}</footer>
      </div>
    </div>
  );
}
