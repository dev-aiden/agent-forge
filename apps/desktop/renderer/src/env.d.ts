/// <reference types="vite/client" />
import type { AgentForgeApi } from "../../shared/api";

declare global {
  interface Window {
    agentForge: AgentForgeApi;
  }
}
