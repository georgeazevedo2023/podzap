import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest config — only needs to teach Vite about the `@/` alias used
 * throughout the app (matches tsconfig.json's `paths: { "@/*": ["./*"] }`).
 * Next.js handles this implicitly in build, but Vitest runs bare Node so
 * we wire it up here.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
    },
  },
});
