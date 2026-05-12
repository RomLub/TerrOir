// vitest globalSetup pour la suite SQL-integration.
//
// Objet : extraire les seeded keys runtime du Supabase CLI local (qui peuvent
// changer entre versions CLI, cf. v2.92+ avec nouveau JWT_SECRET default) et
// les exposer en `process.env.TEST_SUPABASE_{ANON,SERVICE_ROLE}_KEY` avant
// que vitest n'importe le moindre fichier de test.
//
// Helpers/client.ts lit ces env vars en priorité, sinon retombe sur les
// fallback hardcoded (cohérents avec Supabase CLI v2.92+).
//
// Stratégie fail-open : si `supabase status -o env` échoue (Docker down,
// CLI pas installée, format inattendu), on warn + on ne pose rien — les
// helpers utilisent les fallback hardcoded, et isLocalSupabaseReachable()
// déclenchera describe.skip si l'URL aussi est down.
//
// Run once. Pas de teardown nécessaire (process.env est éphémère au runner).

import { execSync } from "node:child_process";

const LOG_PREFIX = "[test-sql-setup]";

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function setup(): Promise<void> {
  try {
    const stdout = execSync("npx supabase status -o env", {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      encoding: "utf-8",
    });
    const parsed = parseDotEnv(stdout);

    let loaded = 0;
    if (parsed.ANON_KEY) {
      process.env.TEST_SUPABASE_ANON_KEY = parsed.ANON_KEY;
      loaded++;
    }
    if (parsed.SERVICE_ROLE_KEY) {
      process.env.TEST_SUPABASE_SERVICE_ROLE_KEY = parsed.SERVICE_ROLE_KEY;
      loaded++;
    }
    if (parsed.API_URL) {
      process.env.TEST_SUPABASE_URL = parsed.API_URL;
      loaded++;
    }

    if (loaded === 0) {
      console.warn(
        `${LOG_PREFIX} supabase status parsed OK mais aucune clé trouvée (format inattendu). Fallback hardcoded.`,
      );
    } else {
      console.log(
        `${LOG_PREFIX} runtime keys loaded from supabase status (${loaded} env vars exported).`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `${LOG_PREFIX} supabase status failed, falling back to hardcoded defaults. Cause: ${message.split(/\r?\n/)[0]}`,
    );
  }
}
