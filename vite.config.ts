import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This config runs in Node. Declared locally so we don't add @types/node to the
// app's tsconfig (which would leak Node globals into browser/worker source).
declare const process: { env: Record<string, string | undefined> };

// Tauri expects a fixed port and looks at TAURI_* env vars during `tauri dev`.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Pages serves a project site at /logviewer/; desktop + dev use "/".
  // The Pages workflow sets PAGES_BASE=/logviewer/.
  base: process.env.PAGES_BASE || "/",
  plugins: [react()],
  // Prevent Vite from obscuring Rust errors and pin the dev server for Tauri.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Don't watch the Rust source tree from Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Workers are authored as ES modules.
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
