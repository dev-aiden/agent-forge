import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = import.meta.dirname;

/**
 * The production CSP in index.html forbids inline scripts. The Vite dev server
 * needs an inline React Refresh preamble and a websocket, so relax the policy
 * for `electron-vite dev` only.
 */
function devCsp(): Plugin {
  return {
    name: "agent-forge:dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*");
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rolldownOptions: { input: { index: resolve(root, "main/index.ts") } },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        input: { index: resolve(root, "preload/index.ts") },
        // Sandboxed preloads cannot be ES modules.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(root, "renderer"),
    plugins: [react(), tailwindcss(), devCsp()],
    build: {
      rolldownOptions: { input: { index: resolve(root, "renderer/index.html") } },
    },
  },
});
