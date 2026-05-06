import { defineConfig } from "vitest/config";
import path from "node:path";

// Config dédiée tests intégration SQL (T-296). Exécutée via `npm run test:sql`.
// Pré-requis : `npx supabase start` (Docker) — sinon les tests sont skip
// proprement via isLocalSupabaseReachable() dans helpers/client.ts.
//
// Pas de transform JSX (pas de .tsx en SQL integration), pas de setupFiles
// global (pas de mock server-only nécessaire — on tape la vraie DB).
export default defineConfig({
  test: {
    include: ["tests/sql-integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: "default",
    // Tests SQL touchent une DB partagée : pas de parallélisme intra-fichier
    // pour réduire les races sur le seed/cleanup. Vitest parallélise les
    // fichiers entre eux par défaut.
    fileParallelism: false,
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
