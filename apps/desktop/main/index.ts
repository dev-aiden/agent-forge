import { app, BrowserWindow, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, type AppInfo } from "../shared/api";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * --smoke-test: open the window hidden, wait until the renderer has rendered
 * data fetched through preload, print SMOKE_OK and exit 0. Any failure or a
 * timeout exits 1. Used locally and in CI to prove the app starts on each OS.
 */
const SMOKE = process.argv.includes("--smoke-test");
const SMOKE_TIMEOUT_MS = 60_000;

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
  };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: "Agent Forge",
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

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && !app.isPackaged) void win.loadURL(devUrl);
  else void win.loadFile(join(here, "../renderer/index.html"));

  return win;
}

ipcMain.handle(IPC.getInfo, () => getInfo());

ipcMain.on(IPC.rendererReady, () => {
  if (!SMOKE) return;
  console.log(`SMOKE_OK ${JSON.stringify(getInfo())}`);
  app.exit(0);
});

app.whenReady().then(() => {
  if (SMOKE) setTimeout(() => smokeFail(`timeout after ${SMOKE_TIMEOUT_MS}ms`), SMOKE_TIMEOUT_MS);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
