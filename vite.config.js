import { resolve } from "node:path";
import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sites()],
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve("worker/index.js"),
      external: ["cloudflare:workers"],
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        entryFileNames: "server/index.js",
        chunkFileNames: "server/chunks/[name]-[hash].js",
        assetFileNames: "server/assets/[name]-[hash][extname]"
      }
    }
  }
});
