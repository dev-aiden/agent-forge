/// <reference types="vite/client" />
import type { KitroomApi } from "../../shared/api";

declare global {
  interface Window {
    kitroom: KitroomApi;
  }
}
