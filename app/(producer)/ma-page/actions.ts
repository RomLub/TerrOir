"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveProducerOwner } from "@/lib/producers/resolve-owner";
import {
  revalidateProducerCard,
  revalidateProducersSearch,
} from "@/lib/stats/revalidate";

// Action serveur d'enregistrement de la page publique producteur (chantier 3 —
// plomberie). Remplace le write Supabase navigateur sur la table `producers`.
//
// GARDE-FOU SÉCURITÉ : en service_role le trigger
// producers_block_owner_admin_columns est bypassé. C'est donc CE schema (liste
// blanche stricte) + le build explicite de l'UPDATE qui empêchent l'écriture
// de colonnes admin-only (statut, slug, latitude/longitude, note_moyenne,
// nb_avis, badge_*_score, stripe_*, bio_validated_at, publication_requested_at,
// user_id...). Toute clé inconnue envoyée par le client est supprimée par zod ;
// l'UPDATE n'écrit que les champs ci-dessous. L'ownership vient de
// resolveProducerOwner (id serveur), jamais d'un id fourni par le client.

export type ProfileActionState = { error?: string; success?: boolean };

const profileSchema = z.object({
  nom_exploitation: z.string().trim().min(1, "Le nom est requis").max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  histoire: z.string().trim().max(10000).nullable().optional(),
  generations: z.number().int().min(0).max(99).nullable().optional(),
  annee_creation: z.number().int().min(1800).max(2100).nullable().optional(),
  especes: z.array(z.string().max(100)).max(50).nullable().optional(),
  labels: z.array(z.string().max(100)).max(50).nullable().optional(),
  commune: z.string().trim().max(200).nullable().optional(),
  code_postal: z.string().trim().max(20).nullable().optional(),
  photo_principale: z.string().max(2000).nullable().optional(),
  photos: z.array(z.string().max(2000)).max(6).nullable().optional(),
  bio: z.boolean(),
  bio_certificate_number: z.string().trim().max(100).nullable().optional(),
});

export type ProfileInput = z.input<typeof profileSchema>;

export async function updateProfileAction(
  input: ProfileInput,
): Promise<ProfileActionState> {
  const session = await getSessionUser();
  if (!session) return { error: "Non authentifié" };

  const res = await resolveProducerOwner(session.id);
  if ("error" in res) return { error: res.error };
  const { owner } = res;

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }
  const d = parsed.data;

  // Build EXPLICITE : uniquement des colonnes producer-writable. Si le
  // producteur décoche bio, on efface le numéro de certificat.
  const update = {
    nom_exploitation: d.nom_exploitation,
    description: d.description ?? null,
    histoire: d.histoire ?? null,
    generations: d.generations ?? null,
    annee_creation: d.annee_creation ?? null,
    especes: d.especes && d.especes.length > 0 ? d.especes : null,
    labels: d.labels && d.labels.length > 0 ? d.labels : null,
    commune: d.commune ?? null,
    code_postal: d.code_postal ?? null,
    photo_principale: d.photo_principale ?? null,
    photos: d.photos && d.photos.length > 0 ? d.photos : null,
    bio: d.bio,
    bio_certificate_number: d.bio ? (d.bio_certificate_number ?? null) : null,
  };

  const admin = createSupabaseAdminClient();
  const { error: updateError } = await admin
    .from("producers")
    .update(update)
    .eq("id", owner.id);

  if (updateError) {
    console.error(
      `UPDATE_PROFILE_ERROR producer_id=${owner.id} error=${updateError.message}`,
    );
    return { error: "Enregistrement impossible." };
  }

  if (owner.slug) {
    await revalidateProducerCard({
      slug: owner.slug,
      source: "producer-ma-page-save",
    });
  }
  await revalidateProducersSearch({
    source: "producer-ma-page-save",
    producerId: owner.id,
  });

  return { success: true };
}
