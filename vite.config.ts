import { defineConfig } from "vite";

export default defineConfig({
  base: "/pullups/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
