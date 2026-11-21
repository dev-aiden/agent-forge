// Sandboxed preload: the only bridge between the renderer and the main process.
// Expose narrow, purpose-built functions only — never ipcRenderer itself.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentForgeApi } from "../shared/api";

const api: AgentForgeApi = {
  getInfo: () => ipcRenderer.invoke(IPC.getInfo),
  getOverview: (project) => ipcRenderer.invoke(IPC.getOverview, project),
  pickProject: () => ipcRenderer.invoke(IPC.pickProject),
  notifyReady: (error) => ipcRenderer.send(IPC.rendererReady, typeof error === "string" ? error : undefined),
};

contextBridge.exposeInMainWorld("agentForge", api);
