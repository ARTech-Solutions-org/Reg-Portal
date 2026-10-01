import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4100", changeOrigin: true },
      "/scanner": { target: "http://127.0.0.1:3001", changeOrigin: true, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
