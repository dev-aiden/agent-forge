// Sandboxed preload: the only bridge between the renderer and the main process.
// Expose narrow, purpose-built functions only — never ipcRenderer itself.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AgentForgeApi } from "../shared/api";

/** Adds a main → renderer listener and returns a function that removes it. */
function subscribe<A extends unknown[]>(channel: string, fn: (...args: A) => void): () => void {
  const listener = (_event: unknown, ...args: unknown[]) => fn(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

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
  importAgents: () => ipcRenderer.invoke(IPC.importAgents),
  saveAgent: (agent, previousName) => ipcRenderer.invoke(IPC.saveAgent, agent, previousName),
  deleteAgent: (name) => ipcRenderer.invoke(IPC.deleteAgent, name),
  listSkills: () => ipcRenderer.invoke(IPC.listSkills),
  importSkills: () => ipcRenderer.invoke(IPC.importSkills),
  saveSkill: (skill, previousName) => ipcRenderer.invoke(IPC.saveSkill, skill, previousName),
  deleteSkill: (name) => ipcRenderer.invoke(IPC.deleteSkill, name),
  getRule: () => ipcRenderer.invoke(IPC.getRule),
  saveRule: (rule) => ipcRenderer.invoke(IPC.saveRule, rule),
  importRule: () => ipcRenderer.invoke(IPC.importRule),
  unmanageRule: () => ipcRenderer.invoke(IPC.unmanageRule),
  listMcp: () => ipcRenderer.invoke(IPC.listMcp),
  saveMcp: (server, previousName) => ipcRenderer.invoke(IPC.saveMcp, server, previousName),
  deleteMcp: (name) => ipcRenderer.invoke(IPC.deleteMcp, name),
  importMcp: () => ipcRenderer.invoke(IPC.importMcp),
  unmanageMcp: () => ipcRenderer.invoke(IPC.unmanageMcp),
  previewApply: () => ipcRenderer.invoke(IPC.previewApply),
  apply: (previewId) => ipcRenderer.invoke(IPC.apply, previewId),
  undo: (applyId) => ipcRenderer.invoke(IPC.undo, applyId),
  history: () => ipcRenderer.invoke(IPC.history),
  setWriteScope: (scope) => ipcRenderer.invoke(IPC.setWriteScope, scope),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  checkForUpdate: () => ipcRenderer.invoke(IPC.checkForUpdate),
  termSpawn: (target, cols, rows) => ipcRenderer.invoke(IPC.termSpawn, target, cols, rows),
  termWrite: (id, data) => ipcRenderer.send(IPC.termWrite, id, data),
  termResize: (id, cols, rows) => ipcRenderer.send(IPC.termResize, id, cols, rows),
  termKill: (id) => ipcRenderer.send(IPC.termKill, id),
  onTermData: (callback) => subscribe(IPC.termData, (id: number, data: string) => callback(id, data)),
  onTermExit: (callback) => subscribe(IPC.termExit, (id: number, code: number) => callback(id, code)),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  clipboardRead: () => ipcRenderer.invoke(IPC.clipboardRead),
  clipboardWrite: (text) => ipcRenderer.send(IPC.clipboardWrite, text),
  notifyReady: (error) => ipcRenderer.send(IPC.rendererReady, typeof error === "string" ? error : undefined),
};

contextBridge.exposeInMainWorld("agentForge", api);
