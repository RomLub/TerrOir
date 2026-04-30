import { defineConfig } from "vitest/config";
import { transformWithOxc } from "vite";
import path from "node:path";

// rolldown-vite (vitest 4) ne transforme pas le JSX dans les .tsx lors du
// SSR transform — on le pré-transforme via OXC (lang=tsx) pour que les
// routes Next .tsx restent importables depuis les tests. Migration depuis
// transformWithEsbuild (deprecated dans vite 8) vers transformWithOxc, le
// nouveau transformer officiel.
export default defineConfig({
  plugins: [
    {
      name: "tsx-jsx-pretransform",
      enforce: "pre",
      async transform(code, id) {
        if (!id.endsWith(".tsx")) return null;
        const result = await transformWithOxc(code, id, {
          lang: "tsx",
          jsx: { runtime: "automatic" },
        });
        return { code: result.code, map: result.map };
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    reporters: "default",
    // Setup file global : mocke `server-only` (import virtuel Next.js
    // non résolvable hors webpack) une fois pour tous les tests.
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
