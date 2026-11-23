// Apps launched from Finder / a desktop launcher get a minimal PATH, so CLIs
// installed via npm, Homebrew, ~/.local/bin, nvm... are not found. Like other
// editors, ask the user's login shell for its PATH once at startup.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const START = "__KITROOM_PATH_START__";
const END = "__KITROOM_PATH_END__";
const TIMEOUT_MS = 5000;

/** Common install locations, used as a fallback and appended to the shell PATH. */
function fallbackDirs(): string[] {
  const home = homedir();
  if (process.platform === "win32") return [];
  return [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

function merge(...lists: (string | undefined)[]): string {
  const dirs = lists.flatMap((l) => (l ? l.split(delimiter) : [])).filter(Boolean);
  return [...new Set(dirs)].join(delimiter);
}

function loginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    try {
      // -i -l: load the same profile files a terminal window would.
      const child = spawn(shell, ["-ilc", `printf '${START}%s${END}' "$PATH"`], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, TERM: "dumb" },
        detached: false,
      });
      const timer = setTimeout(() => {
        child.kill();
        finish(null);
      }, TIMEOUT_MS);
      child.stdout.on("data", (d) => (out += d));
      child.on("error", () => finish(null));
      child.on("exit", () => {
        clearTimeout(timer);
        const m = out.match(new RegExp(`${START}(.*?)${END}`, "s"));
        finish(m?.[1]?.trim() || null);
      });
    } catch {
      finish(null);
    }
  });
}

let cached: Promise<string> | null = null;

/** PATH to use for finding and launching CLIs. Resolved once, then cached. */
export function resolvedPath(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      if (process.platform === "win32") return process.env.PATH ?? "";
      const fromShell = await loginShellPath();
      return merge(fromShell ?? undefined, process.env.PATH, fallbackDirs().join(delimiter));
    })();
  }
  return cached;
}

/** process.env with the resolved PATH. */
export async function cliEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PATH = await resolvedPath();
  return env;
}

/** Finds a CLI on the resolved PATH (never executes it). */
export async function findCli(tool: import("@kitroom/model").ToolId): Promise<string | null> {
  const { scan } = await import("@kitroom/adapters");
  const { homedir } = await import("node:os");
  const result = await scan({ home: homedir(), project: "", env: { PATH: await resolvedPath(), PATHEXT: process.env.PATHEXT } });
  return result.tools.find((t) => t.id === tool)?.binary ?? null;
}
