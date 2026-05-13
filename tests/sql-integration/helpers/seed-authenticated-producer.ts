import type { SupabaseClient } from "@supabase/supabase-js";
import {
  seedAuthenticatedClient,
  cleanupAuthenticatedSession,
  type AuthenticatedSession,
} from "./auth";

// Helper composite : crée un user authentifié + signe-in + INSERT producer
// rattaché via user_id. Nécessaire pour tester les triggers/policies dont
// la discrimination repose sur (auth.uid() = producers.user_id) côté
// authenticated PostgREST réel.
//
// Vs `seedProducer` (helpers/seed.ts) : seedProducer ne signe pas le user
// (retour sans `client` signed-in), donc on ne peut tester que le bypass
// service_role. Ce helper comble le gap pour les tests F-008
// (producers_block_owner_admin_columns trigger) et toute future cible
// similaire (RLS producers UPDATE, RPC producer-owned, etc.).

export type AuthenticatedProducerSession = AuthenticatedSession & {
  producerId: string;
  producerSlug: string;
};

export async function seedAuthenticatedProducer(
  adminClient: SupabaseClient,
  overrides?: {
    emailPrefix?: string;
    statut?: string;
    nomExploitation?: string;
  },
): Promise<AuthenticatedProducerSession> {
  // 1. Créer user auth + public.users + signin (helper canonique)
  const session = await seedAuthenticatedClient(adminClient, {
    emailPrefix: overrides?.emailPrefix ?? "f008-prod-owner",
  });

  // 2. Étendre roles pour inclure 'producer' (seedAuthenticatedClient pose
  //    par défaut roles=['consumer']). Via service_role pour bypass trigger
  //    F-009 users_block_owner_protected_columns_trigger qui bloque self-update
  //    de roles côté authenticated.
  const { error: rolesErr } = await adminClient
    .from("users")
    .update({ roles: ["consumer", "producer"] })
    .eq("id", session.userId);
  if (rolesErr) {
    await cleanupAuthenticatedSession(adminClient, session);
    throw new Error(
      `seedAuthenticatedProducer roles upgrade failed: ${rolesErr.message}`,
    );
  }

  // 3. INSERT producer rattaché via service_role (le trigger F-008 bypass
  //    sur INSERT côté service_role naturellement).
  const slug = `f008-prod-${crypto.randomUUID().slice(0, 8)}`;
  const { data: prod, error: prodErr } = await adminClient
    .from("producers")
    .insert({
      user_id: session.userId,
      slug,
      statut: overrides?.statut ?? "draft",
      nom_exploitation: overrides?.nomExploitation ?? "Ferme test F-008",
    })
    .select("id, slug")
    .single();
  if (prodErr || !prod) {
    await cleanupAuthenticatedSession(adminClient, session);
    throw new Error(
      `seedAuthenticatedProducer producer insert failed: ${prodErr?.message}`,
    );
  }

  return {
    ...session,
    producerId: prod.id,
    producerSlug: prod.slug,
  };
}

export async function cleanupAuthenticatedProducerSession(
  adminClient: SupabaseClient,
  session: AuthenticatedProducerSession,
): Promise<void> {
  // Ordre inverse INSERT : producers → user (cleanupAuthenticatedSession
  // gère public.users + auth.users).
  await adminClient.from("producers").delete().eq("id", session.producerId);
  await cleanupAuthenticatedSession(adminClient, session);
}
