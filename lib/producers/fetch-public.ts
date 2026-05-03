import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ModeElevage,
  Alimentation,
  DensiteAnimale,
} from "@/lib/producers/score-carbone-enums";

// Fields publics exposés côté consumer. Exclut les colonnes internes
// (stripe_account_id, stripe_cleanup_pending, abonnement_*, siret,
// forme_juridique, type_production, deleted_at, created_at) — le helper
// les filtre à la lecture. user_id est inclus uniquement pour permettre
// la jointure embarquée vers public.users (prenom de la personne physique
// derrière la ferme — utilisé par getProducerDisplayName côté UI).
export interface ProducerPublic {
  id: string;
  slug: string;
  nom_exploitation: string;
  // Jointure embarquée Supabase vers public.users via la FK
  // producers.user_id → users.id. Source unique pour le prénom d'affichage
  // depuis la suppression de la lecture de producers.prenom_affichage
  // (DROP COLUMN prévu chantier suivant).
  users: { prenom: string | null } | null;
  commune: string | null;
  code_postal: string | null;
  adresse: string | null;
  // Coordonnées floutées (arrondies à 2 décimales) pour le widget distance
  // de la fiche publique. Précision ~1 km (suffisant pour un affichage à
  // vol d'oiseau, masque l'adresse personnelle du producteur — souvent =
  // domicile en élevage fermier). Les coordonnées brutes ne quittent
  // jamais le serveur via ce helper. Cf. roundCoord ci-dessous.
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
  mode_elevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densite_animale: DensiteAnimale | null;
}

const PUBLIC_COLUMNS =
  "id, slug, nom_exploitation, commune, code_postal, adresse, latitude, longitude, photo_principale, photos, description, histoire, annee_creation, generations, especes, labels, badge_stock_score, badge_confirmation_score, badge_annulation_score, note_moyenne, nb_avis, mode_elevage, alimentation, densite_animale, users:user_id(prenom)";

// Floute les coordonnées producteur avant exposition côté consumer.
// 2 décimales = ~1.1 km de précision en latitude, ~750 m en longitude à
// 47° (Sarthe). Compromis entre :
//   - widget distance utile (erreur d'arrondi << GMS_DISTANCE_KM_REFERENCE),
//   - non-identification de l'adresse personnelle du producteur (domicile
//     en élevage fermier dans la majorité des cas) — décision comité T-200.
function roundCoord(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

// Helper canonical pour fetch un producer visible publiquement par son slug.
// Garanties :
//   - statut = 'public' (filter RLS équivalent + defense in depth applicative)
//   - deleted_at IS NULL (exclusion des producers anonymisés via RGPD)
//   - latitude/longitude floutées (cf. roundCoord) avant retour
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
  if (!data) return null;
  // Supabase JS peut typer une jointure FK 1:1 comme objet OU array selon la
  // version du client. Normalisation systématique vers `{ prenom } | null`
  // pour que l'interface ProducerPublic reste simple côté consumers.
  const raw = data as Omit<ProducerPublic, "users"> & {
    users: { prenom: string | null } | { prenom: string | null }[] | null;
  };
  const usersField = Array.isArray(raw.users)
    ? (raw.users[0] ?? null)
    : (raw.users ?? null);
  return {
    ...raw,
    users: usersField,
    latitude: roundCoord(raw.latitude),
    longitude: roundCoord(raw.longitude),
  };
}
