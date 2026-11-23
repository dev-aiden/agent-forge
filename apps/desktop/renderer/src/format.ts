import type { Scope } from "@kitroom/model";

/** Shows paths under the project as `./…` and under home as `~/…`. Works with / and \ separators. */
export function makeShortPath(home: string, project: string | null) {
  return (path: string): string => {
    if (project && (path === project || path.startsWith(project + "/") || path.startsWith(project + "\\"))) {
      return "." + path.slice(project.length);
    }
    if (home && (path === home || path.startsWith(home + "/") || path.startsWith(home + "\\"))) {
      return "~" + path.slice(home.length);
    }
    return path;
  };
}

export const SCOPE_STYLE: Record<Scope, string> = {
  global: "border-sky-800 text-sky-300",
  project: "border-emerald-800 text-emerald-300",
  local: "border-amber-800 text-amber-300",
};

/** Strips Electron's "Error invoking remote method" wrapper from IPC errors. */
export function errorText(e: unknown): string {
  return String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, "");
}
