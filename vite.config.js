import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-page static site: every HTML page is its own entry so
// `vite build` emits all of them into dist/.
const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: page("index.html"),
        about: page("about.html"),
        playground: page("playground.html"),
      },
    },
  },
});
