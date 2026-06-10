import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest config — only needs to teach Vite about the `@/` alias used
 * throughout the app (matches tsconfig.json's `paths: { "@/*": ["./*"] }`).
 * Next.js handles this implicitly in build, but Vitest runs bare Node so
 * we wire it up here.
 */
export default defineConfig({
  test: {
    // `npm run build` local copia tests/ pra .next/standalone — sem este
    // exclude o vitest roda as cópias stale junto e elas falham.
    exclude: ["**/node_modules/**", "**/.next/**", "**/e2e/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
    },
  },
});
