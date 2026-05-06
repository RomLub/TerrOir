import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deptCodeFromCodePostal } from "@/lib/geo/france-departements";

// Helper coverage : agrège les producers publics par département (extrait des
// 2 premiers chiffres du code_postal).
//
// Filtres :
//   - producers.statut = 'public'  (cohérent fetchPublicProducerBySlug)
//   - producers.deleted_at IS NULL (cohérent public-stats)
//
// Cache function-level (10 min) avec tag 'coverage-departments' invalidable
// via revalidateCoverageDepartments() côté lib/stats/revalidate.ts. La page
// /livraison ne bouge pas de minute en minute ; un revalidate court n'apporte
// pas de valeur côté UX et coûte des hits DB pour rien.
//
// Fail-safe : si la query plante, on retourne un payload vide (carte non
// couverte, count national 0). Mieux vaut un état désertique que crash de
// la page /livraison sur incident DB.

export interface CoverageData {
  /** Codes département FR (ex. "72", "49", "2A") où au moins 1 producer public actif. */
  coveredDepartments: string[];
  /** Compteur producers publics par code département. */
  departmentProducerCounts: Record<string, number>;
  /** Total producers publics (agrégat tous départements confondus). */
  totalProducers: number;
  /** Nombre de départements distincts couverts. */
  totalDepartments: number;
}

const EMPTY: CoverageData = {
  coveredDepartments: [],
  departmentProducerCounts: {},
  totalProducers: 0,
  totalDepartments: 0,
};

async function fetchCoverageDepartmentsRaw(): Promise<CoverageData> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("producers")
    .select("code_postal")
    .eq("statut", "public")
    .is("deleted_at", null);

  if (error) {
    console.error(
      `[COVERAGE_DEPTS_ERR] producers fetch failed: ${error.message}`,
    );
    return EMPTY;
  }

  const counts: Record<string, number> = {};
  let totalProducers = 0;

  for (const row of (data ?? []) as Array<{ code_postal: string | null }>) {
    const code = deptCodeFromCodePostal(row.code_postal);
    if (!code) continue;
    counts[code] = (counts[code] ?? 0) + 1;
    totalProducers += 1;
  }

  const coveredDepartments = Object.keys(counts).sort();

  return {
    coveredDepartments,
    departmentProducerCounts: counts,
    totalProducers,
    totalDepartments: coveredDepartments.length,
  };
}

export const getCoverageDepartments = unstable_cache(
  fetchCoverageDepartmentsRaw,
  ["coverage-departments"],
  {
    revalidate: 600,
    tags: ["coverage-departments"],
  },
);

// Exporté pour les tests (bypass cache Next.js qui n'est pas accessible
// proprement en environnement vitest sans plumberie supplémentaire).
export { fetchCoverageDepartmentsRaw };
