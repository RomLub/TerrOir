import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Helper Supabase pour tests d'intégration SQL contre l'instance locale.
//
// L'instance locale Supabase (npx supabase start) expose par défaut :
//   - API URL  : http://127.0.0.1:54321 (cf. supabase/config.toml [api].port)
//   - service_role : clé seedée stable, exposée par `supabase status`
//
// Ces valeurs sont pré-câblées via env vars TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY.
// Si non définies, on tombe sur les defaults locaux Supabase CLI (mêmes seeded
// keys partout — sans danger, jamais des creds prod).
//
// Documentation officielle des seeded keys :
// https://supabase.com/docs/guides/local-development/cli/config

const DEFAULT_LOCAL_URL = "http://127.0.0.1:54321";
// Seeded keys Supabase CLI local — publiques par design (toute install locale
// les utilise). Jamais utilisées en prod.
const DEFAULT_LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UtZGVtbyIsImlhdCI6MTY0MTc2OTIwMCwiZXhwIjoxNzk5NTM1NjAwfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q";

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
