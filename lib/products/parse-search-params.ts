// Parsing des searchParams de la page /produits (T-220 PR-C).
//
// 3 filtres optionnels combinables : ?cut=<slug> ?animal=<slug> ?category=<slug>.
// Tout slug invalide (regex non-matchée, vide, ou tableau) est ignoré
// silencieusement → la query Supabase n'embarque jamais de junk. Slug
// n'existant pas en DB est traité plus loin dans fetchPublicProducts
// (résolution slug → id retourne null → résultats vides cohérents Q3).

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ProductsFilters = {
  cut: string | null;
  animal: string | null;
  category: string | null;
};

function sanitizeSlug(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return SLUG_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseProductsSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): ProductsFilters {
  return {
    cut: sanitizeSlug(searchParams?.cut),
    animal: sanitizeSlug(searchParams?.animal),
    category: sanitizeSlug(searchParams?.category),
  };
}
