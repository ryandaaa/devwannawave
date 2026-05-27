import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const tauriDevHost = process.env["TAURI_DEV_HOST"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: tauriDevHost ?? false,
    hmr: tauriDevHost
      ? { protocol: "ws", host: tauriDevHost, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
