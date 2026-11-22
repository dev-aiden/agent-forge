// Sandboxed preload: the only bridge between the renderer and the main process.
// Expose narrow, purpose-built functions only — never ipcRenderer itself.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentForgeApi } from "../shared/api";

const api: AgentForgeApi = {
  getInfo: () => ipcRenderer.invoke(IPC.getInfo),
  getOverview: (project) => ipcRenderer.invoke(IPC.getOverview, project),
  pickProject: () => ipcRenderer.invoke(IPC.pickProject),
  onOverviewChanged: (callback) => {
    const listener = (_event: unknown, overview: Parameters<typeof callback>[0]) => callback(overview);
    ipcRenderer.on(IPC.overviewChanged, listener);
    return () => {
      ipcRenderer.removeListener(IPC.overviewChanged, listener);
    };
  },
  listAgents: () => ipcRenderer.invoke(IPC.listAgents),
  saveAgent: (agent, previousName) => ipcRenderer.invoke(IPC.saveAgent, agent, previousName),
  deleteAgent: (name) => ipcRenderer.invoke(IPC.deleteAgent, name),
  previewApply: () => ipcRenderer.invoke(IPC.previewApply),
  apply: (previewId) => ipcRenderer.invoke(IPC.apply, previewId),
  undo: (applyId) => ipcRenderer.invoke(IPC.undo, applyId),
  history: () => ipcRenderer.invoke(IPC.history),
  notifyReady: (error) => ipcRenderer.send(IPC.rendererReady, typeof error === "string" ? error : undefined),
};

contextBridge.exposeInMainWorld("agentForge", api);
