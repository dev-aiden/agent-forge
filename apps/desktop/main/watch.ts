// Watches every config location the adapters know about and reports changes (debounced).
// Read-only: chokidar only observes the file system.
import { watch, type FSWatcher } from "chokidar";
import { isSensitive, TOOLS, type PathContext } from "@kitroom/adapters";

/** Candidate paths of all tools. Project/local scope only when a project is selected. */
export function watchedPaths(ctx: PathContext): string[] {
  const paths = TOOLS.flatMap((t) => t.candidates(ctx))
    .filter((c) => ctx.project || c.scope === "global")
    .map((c) => c.path);
  return [...new Set(paths)];
}

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes watch/close so overlapping calls never leak a watcher. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onChange: () => void,
    private readonly debounceMs = 400,
  ) {}

  /** Replaces the watched set. Resolves once the initial scan is done. */
  watch(paths: string[]): Promise<void> {
    const run = this.queue.then(() => this.replace(paths));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async replace(paths: string[]): Promise<void> {
    await this.closeNow();
    const watcher = watch(paths, {
      ignoreInitial: true,
      depth: 5,
      // Credential files are never observed, and macOS Finder metadata is noise.
      ignored: (path: string) => isSensitive(path) || path.endsWith(".DS_Store"),
    });
    watcher.on("all", () => this.schedule());
    watcher.on("error", (e) => console.error("config watcher error:", e));
    this.watcher = watcher;
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange();
    }, this.debounceMs);
  }

  close(): Promise<void> {
    const run = this.queue.then(() => this.closeNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async closeNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.watcher;
    this.watcher = null;
    await w?.close();
  }
}
