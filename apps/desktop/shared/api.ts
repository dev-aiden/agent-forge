// Types shared by main, preload and renderer. Keep this file free of runtime imports.

export interface AppInfo {
  name: string;
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  electron: string;
  node: string;
  chrome: string;
}

/** The only API the renderer can reach. Exposed by preload as `window.agentForge`. */
export interface AgentForgeApi {
  getInfo(): Promise<AppInfo>;
  /** Called once the UI has rendered with data from the main process (used by --smoke-test). */
  notifyReady(): void;
}

export const IPC = {
  getInfo: "app:get-info",
  rendererReady: "app:renderer-ready",
} as const;
