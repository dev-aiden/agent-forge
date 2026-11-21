// Sandboxed preload: the only bridge between the renderer and the main process.
// Expose narrow, purpose-built functions only — never ipcRenderer itself.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentForgeApi } from "../shared/api";

const api: AgentForgeApi = {
  getInfo: () => ipcRenderer.invoke(IPC.getInfo),
  notifyReady: () => ipcRenderer.send(IPC.rendererReady),
};

contextBridge.exposeInMainWorld("agentForge", api);
