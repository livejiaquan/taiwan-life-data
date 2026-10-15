import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages project site: https://livejiaquan.github.io/taiwan-life-data/
  base: process.env.PUBLIC_BASE ?? "/taiwan-life-data/",
  plugins: [react()],
  build: {
    target: "es2022",
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, "index.html"), status: resolve(import.meta.dirname, "status/index.html"), today: resolve(import.meta.dirname, "today/index.html") },
    },
  },
});
