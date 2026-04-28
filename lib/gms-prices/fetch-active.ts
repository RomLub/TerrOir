import type { SupabaseClient } from "@supabase/supabase-js";

export type GmsPriceFiliere = "bovin" | "porcin" | "ovin";

// Référence active de comparaison prix GMS / prix TerrOir affichée sur la
// page /notre-demarche. Snake_case aligné convention codebase (cf.
// lib/producers/fetch-public.ts) : passe-plat direct DB → UI sans mapping.
//
// Colonnes internes (notes_admin, created_at, updated_at) exclues du SELECT
// public — aucun usage applicatif consumer pour ces champs, et les exposer
// brouille la surface API. Ajout possible si besoin futur.
export interface GmsPrice {
  id: string;
  slug: string;
  filiere: GmsPriceFiliere;
  libelle: string;
  description_courte: string | null;
  prix_gms_kg: number;
  prix_terroir_kg_min: number | null;
  prix_terroir_kg_max: number | null;
  prix_terroir_kg_moyen: number | null;
  mois_reference: string;
  source: string;
  source_url: string | null;
  ordre_affichage: number;
  active: boolean;
}

const PUBLIC_COLUMNS =
  "id, slug, filiere, libelle, description_courte, prix_gms_kg, prix_terroir_kg_min, prix_terroir_kg_max, prix_terroir_kg_moyen, mois_reference, source, source_url, ordre_affichage, active";

// Fetch toutes les références gms_prices actives, triées par ordre_affichage
// ASC. Defense-in-depth : refiltre active=true côté applicatif en plus du
// filtre RLS (aligné pattern fetch-public.ts pour resilience contre une
// régression de policy).
//
// Retourne [] sur erreur DB (log préfixé grep-able + non-throw, aligné
// convention codebase qui privilégie la résilience UI à la propagation).
export async function fetchActiveGmsPrices(
  supabase: SupabaseClient,
): Promise<GmsPrice[]> {
  const { data, error } = await supabase
    .from("gms_prices")
    .select(PUBLIC_COLUMNS)
    .eq("active", true)
    .order("ordre_affichage", { ascending: true });

  if (error) {
    console.error(`FETCH_GMS_PRICES_ERROR error=${error.message}`);
    return [];
  }
  return (data ?? []) as GmsPrice[];
}

// Variante filtrée par filière. Defense-in-depth : refiltre active=true +
// filiere=X côté applicatif en plus du filtre RLS.
export async function fetchActiveGmsPricesByFiliere(
  supabase: SupabaseClient,
  filiere: GmsPriceFiliere,
): Promise<GmsPrice[]> {
  const { data, error } = await supabase
    .from("gms_prices")
    .select(PUBLIC_COLUMNS)
    .eq("active", true)
    .eq("filiere", filiere)
    .order("ordre_affichage", { ascending: true });

  if (error) {
    console.error(
      `FETCH_GMS_PRICES_ERROR filiere=${filiere} error=${error.message}`,
    );
    return [];
  }
  return (data ?? []) as GmsPrice[];
}
