import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Helper Supabase pour tests d'intégration SQL contre l'instance locale.
//
// Source des keys (par priorité) :
//   1. Runtime : `tests/sql-integration/setup.ts` (vitest globalSetup) appelle
//      `supabase status -o env` et expose ANON_KEY / SERVICE_ROLE_KEY / API_URL
//      en `process.env.TEST_SUPABASE_*` avant l'import des fichiers de test.
//   2. Fallback : keys hardcoded ci-dessous, alignées sur les seeded JWT
//      stables produits par Supabase CLI v2.92+ (JWT_SECRET default
//      `super-secret-jwt-token-with-at-least-32-characters-long`).
//
// Si l'instance locale n'est pas joignable, isLocalSupabaseReachable() = false
// et les tests sont skippés via describe.skip.
//
// Les seeded keys sont publiques par design (toute install Supabase CLI les
// produit identiques tant que le default JWT secret n'est pas overridé via
// `supabase/config.toml`). Documentation :
// https://supabase.com/docs/guides/local-development/cli/config

const DEFAULT_LOCAL_URL = "http://127.0.0.1:54321";
// Seeded keys Supabase CLI v2.92+ — fallback runtime (le globalSetup peut
// override via env vars).
const DEFAULT_LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DEFAULT_LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export function getSqlIntegrationClient(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL ?? DEFAULT_LOCAL_URL;
  const serviceRoleKey =
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ??
    DEFAULT_LOCAL_SERVICE_ROLE_KEY;

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Anon client local — utilisé pour les tests qui doivent simuler un acteur
// `authenticated` (signInWithPassword) au lieu de bypass service_role.
// Cf. tests/sql-integration/helpers/auth.ts pour le wrapping en flux complet
// "seed user + login → client signed-in".
export function getSqlIntegrationAnonClient(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL ?? DEFAULT_LOCAL_URL;
  const anonKey = process.env.TEST_SUPABASE_ANON_KEY ?? DEFAULT_LOCAL_ANON_KEY;

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Skip helper : si l'instance locale n'est pas accessible (CI sans Docker,
// dev sans `supabase start`), on saute proprement les tests plutôt que de
// faire crasher la suite.
export async function isLocalSupabaseReachable(): Promise<boolean> {
  const url = process.env.TEST_SUPABASE_URL ?? DEFAULT_LOCAL_URL;
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}
