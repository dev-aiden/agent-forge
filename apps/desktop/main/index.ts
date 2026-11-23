import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, type AppInfo, type AppSettings } from "../shared/api";
import { homedir } from "node:os";
import { migrateLegacyHome } from "@kitroom/adapters";
import { buildOverview, overviewFingerprint, validateProject } from "./overview";
import { ConfigWatcher, watchedPaths } from "./watch";
import { registerForgeIpc, smokeCheckWorker } from "./forge";
import { checkForUpdate } from "./update";
import { readSettings, writeSettings } from "./settings";
import { cliEnv } from "./shell-env";
import { killAllSessions, registerTerminalIpc, smokeCheckPty } from "./terminal";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * --smoke-test: open the window hidden, wait until the renderer has rendered
 * the first screen with data from the main process, print SMOKE_OK and exit 0.
 * Any failure or a timeout exits 1. Used locally and in CI on each OS.
 */
const SMOKE = process.argv.includes("--smoke-test");
const SMOKE_TIMEOUT_MS = 60_000;

/** `--project <dir>` opens the app with a project selected. */
function argProject(): string | null {
  const i = process.argv.indexOf("--project");
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ? resolve(value) : null;
}

let mainWindow: BrowserWindow | null = null;

// Live updates: the watcher follows the project of the last getOverview call.
// ~/.claude.json is rewritten by Claude Code all the time, so updates are only
// pushed when the overview really changed.
let watchedProject: string | null | undefined;
let lastFingerprint = "";

const watcher = new ConfigWatcher(() => {
  const project = watchedProject;
  if (project === undefined || !mainWindow) return;
  cliEnv()
    .then((env) => buildOverview(project, homedir(), env))
    .then((overview) => {
      if (project !== watchedProject) return; // project switched meanwhile
      const fp = overviewFingerprint(overview);
      if (fp === lastFingerprint) return;
      lastFingerprint = fp;
      mainWindow?.webContents.send(IPC.overviewChanged, overview);
    })
    .catch((e) => console.error("overview refresh failed:", e));
});

function smokeFail(reason: string): void {
  if (!SMOKE) return;
  console.error(`SMOKE_FAIL ${reason}`);
  app.exit(1);
}

function getInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    initialProject: argProject(),
  };
}

/** Only our own window may call the main process. */
function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

/**
 * Minimal menu. The default one maps Cmd/Ctrl +/-/0 to page zoom, which the
 * terminal uses for its font size. macOS keeps an Edit menu so copy/paste work.
 */
function setMenu(): void {
  const dev = !app.isPackaged;
  const view: Electron.MenuItemConstructorOptions = {
    role: "viewMenu",
    submenu: [{ role: "reload" }, ...(dev ? [{ role: "toggleDevTools" } as const] : []), { type: "separator" }, { role: "togglefullscreen" }],
  };
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, view, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(dev ? Menu.buildFromTemplate([view]) : null);
  }
}

const windowBackground = () => (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff");

/** Native parts (title bar, scrollbars, prefers-color-scheme) follow the chosen theme. */
function applyTheme(settings: AppSettings): AppSettings {
  nativeTheme.themeSource = settings.theme;
  mainWindow?.setBackgroundColor(windowBackground());
  return settings;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    title: "Kitroom",
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    if (!SMOKE) win.show();
  });

  // The renderer only shows bundled UI: block navigation and pop-ups.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.webContents.on("did-fail-load", (_e, code, desc) => smokeFail(`did-fail-load ${code} ${desc}`));
  win.webContents.on("render-process-gone", (_e, details) => smokeFail(`render-process-gone ${details.reason}`));
  win.webContents.on("preload-error", (_e, _path, error) => smokeFail(`preload-error ${error.message}`));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && !app.isPackaged) void win.loadURL(devUrl);
  else void win.loadFile(join(here, "../renderer/index.html"));

  return win;
}

ipcMain.handle(IPC.getInfo, (event) => {
  if (!trusted(event)) throw new Error("untrusted sender");
  return getInfo();
});

ipcMain.handle(IPC.getOverview, async (event, project: unknown) => {
  if (!trusted(event)) throw new Error("untrusted sender");
  const valid = await validateProject(project);
  const overview = await buildOverview(valid, homedir(), await cliEnv());
  lastFingerprint = overviewFingerprint(overview);
  if (valid !== watchedProject) {
    watchedProject = valid;
    // Watching is best-effort: the overview is still returned if it fails.
    watcher.watch(watchedPaths({ home: homedir(), project: valid ?? "", env: process.env })).catch((e) =>
      console.error("cannot watch config paths:", e),
    );
  }
  return overview;
});

ipcMain.handle(IPC.pickProject, async (event) => {
  if (!trusted(event) || !mainWindow) throw new Error("untrusted sender");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select a project folder",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

registerForgeIpc(trusted, () => watchedProject ?? null);
registerTerminalIpc(trusted, () => watchedProject ?? null);

const settingsCtx = () => ({ home: homedir(), project: "", env: process.env });
ipcMain.handle(IPC.getSettings, (event) => {
  if (!trusted(event)) throw new Error("untrusted sender");
  return readSettings(settingsCtx()).then(applyTheme);
});
ipcMain.handle(IPC.saveSettings, (event, settings: unknown) => {
  if (!trusted(event)) throw new Error("untrusted sender");
  return writeSettings(settingsCtx(), settings).then(applyTheme);
});

ipcMain.handle(IPC.checkForUpdate, async (event) => {
  if (!trusted(event)) throw new Error("untrusted sender");
  // No network during smoke tests; respect the setting even if the renderer asks.
  if (SMOKE || !(await readSettings(settingsCtx())).checkUpdates) return null;
  return checkForUpdate(app.getVersion());
});

ipcMain.on(IPC.rendererReady, (event, error: unknown) => {
  if (!SMOKE || !trusted(event)) return;
  if (typeof error === "string") return smokeFail(`renderer: ${error}`);
  // Also prove the bundled rulesync worker and the native pty module run from the packaged app.
  smokeCheckWorker()
    .then(() => smokeCheckPty())
    .then(
    () => {
      console.log(`SMOKE_OK ${JSON.stringify(getInfo())}`);
      app.exit(0);
    },
    (e: unknown) => smokeFail(e instanceof Error ? e.message : String(e)),
  );
});

app.whenReady().then(async () => {
  // Carry data over from the folder used before the rename (Agent Forge v0.1.0).
  await migrateLegacyHome(settingsCtx()).catch((e: unknown) => console.error("could not move ~/.agent-forge:", e));
  applyTheme(await readSettings(settingsCtx()));
  setMenu();
  // Packaged apps get the icon from electron-builder; in dev, show it in the Dock too.
  if (!app.isPackaged && process.platform === "darwin") {
    try {
      app.dock?.setIcon(join(app.getAppPath(), "build", "icon.png"));
    } catch {
      // Cosmetic only; never block startup.
    }
  }
  if (SMOKE) setTimeout(() => smokeFail(`timeout after ${SMOKE_TIMEOUT_MS}ms`), SMOKE_TIMEOUT_MS);
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("before-quit", () => {
  killAllSessions();
  void watcher.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
