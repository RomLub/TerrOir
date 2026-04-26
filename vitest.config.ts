import { defineConfig } from "vitest/config";
import { transformWithEsbuild } from "vite";
import path from "node:path";

// rolldown-vite (vitest 4) ne transforme pas le JSX dans les .tsx lors du
// SSR transform — on le pré-transforme via esbuild (loader=tsx) pour que
// les routes Next .tsx restent importables depuis les tests.
export default defineConfig({
  plugins: [
    {
      name: "tsx-jsx-pretransform",
      enforce: "pre",
      async transform(code, id) {
        if (!id.endsWith(".tsx")) return null;
        const result = await transformWithEsbuild(code, id, {
          loader: "tsx",
          jsx: "automatic",
          target: "es2022",
        });
        return { code: result.code, map: result.map };
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: "default",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
