import { defineConfig } from "vite";

// GitHub Pages serves the site at /<repo-name>/. Override with BASE_PATH if hosting elsewhere.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/foodchexker/",
});
