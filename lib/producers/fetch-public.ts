import type { SupabaseClient } from "@supabase/supabase-js";

// Fields publics exposés côté consumer. Exclut les colonnes internes
// (user_id, stripe_account_id, stripe_cleanup_pending, abonnement_*, siret,
// forme_juridique, type_production, deleted_at, created_at) — le helper
// les filtre à la lecture.
export interface ProducerPublic {
  id: string;
  slug: string;
  nom_exploitation: string;
  // Nullable ici malgré le NOT NULL DB : pendant la fenêtre transitoire
  // entre la migration A (ADD COLUMN nullable) et la migration C
  // (SET NOT NULL), une ligne peut être null. Les consumers qui
  // exploitent ce champ doivent gérer ce cas (cf. post-it fiche produit).
  prenom_affichage: string | null;
  commune: string | null;
  code_postal: string | null;
  adresse: string | null;
  latitude: number | null;
  longitude: number | null;
  photo_principale: string | null;
  photos: string[] | null;
  description: string | null;
  histoire: string | null;
  annee_creation: number | null;
  generations: number | null;
  especes: string[] | null;
  labels: string[] | null;
  badge_stock_score: number | null;
  badge_confirmation_score: number | null;
  badge_annulation_score: number | null;
  note_moyenne: number | null;
  nb_avis: number | null;
}

const PUBLIC_COLUMNS =
  "id, slug, nom_exploitation, prenom_affichage, commune, code_postal, adresse, latitude, longitude, photo_principale, photos, description, histoire, annee_creation, generations, especes, labels, badge_stock_score, badge_confirmation_score, badge_annulation_score, note_moyenne, nb_avis";

// Helper canonical pour fetch un producer visible publiquement par son slug.
// Garanties :
//   - statut = 'public' (filter RLS équivalent + defense in depth applicative)
//   - deleted_at IS NULL (exclusion des producers anonymisés via RGPD)
//
// Retourne null si le slug ne matche rien OU si le producer existe mais n'est
// pas public. L'appelant décide ensuite (notFound, redirect, message).
//
// Centralise la convention d'audit du 22/04 : toute nouvelle page publique qui
// utilise createSupabaseAdminClient() doit passer par ce helper pour garantir
// l'isolation des producers non-publiés.
export async function fetchPublicProducerBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<ProducerPublic | null> {
  const { data, error } = await supabase
    .from("producers")
    .select(PUBLIC_COLUMNS)
    .eq("slug", slug)
    .eq("statut", "public")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(
      `FETCH_PUBLIC_PRODUCER_ERROR slug=${slug} error=${error.message}`,
    );
    return null;
  }
  return (data as ProducerPublic | null) ?? null;
}
