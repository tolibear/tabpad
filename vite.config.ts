import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

function extensionManifest(): Plugin {
  return {
    name: "daybook-extension-manifest",
    closeBundle() {
      const outDir = resolve("dist");
      mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve("manifest.json"), resolve(outDir, "manifest.json"));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), extensionManifest()],
  build: {
    target: "es2020",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@codemirror") || id.includes("@lezer")) return "editor";
          if (id.includes("markdown-it")) return "markdown";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
