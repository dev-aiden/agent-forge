import { createContext, useContext, useEffect, useState } from "react";
import type { Theme } from "../../shared/api";

export type ResolvedTheme = "light" | "dark";

const query = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Resolves "system" with the OS setting and puts the result on <html data-theme>. */
export function useResolvedTheme(theme: Theme): ResolvedTheme {
  const [system, setSystem] = useState<ResolvedTheme>(() => (query().matches ? "dark" : "light"));
  useEffect(() => {
    const mq = query();
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const resolved = theme === "system" ? system : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return resolved;
}

const ThemeContext = createContext<ResolvedTheme>("dark");
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);
