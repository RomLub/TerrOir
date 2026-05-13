import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminProducerInterestRow } from "./types";

// Helper de lecture admin pour la table public.producer_interests.
//
// Architecture : prend un SupabaseClient en argument (typé service_role
// côté appelant via createSupabaseAdminClient) plutôt que de l'instancier
// lui-même. Avantages : (1) testabilité par injection mock ; (2) cohérence
// avec lib/products/admin/categories.ts pattern.
//
// Lecture admin = service_role bypass plutôt que RLS (cohérent avec le
// pattern SSR /suivi-commandes et la doctrine harmonisée de la PR refactor
// admin pattern uniform — toutes les pages SSR admin lisent via service_role,
// même si une policy admin RLS existe, pour éviter le risque de régression
// silencieuse cf. AUDIT_ADMIN § 4.5).

export async function fetchProducerInterestsList(
  admin: SupabaseClient,
): Promise<AdminProducerInterestRow[]> {
  const { data, error } = await admin
    .from("producer_interests")
    .select(
      "id, created_at, prenom, nom, email, telephone, nom_exploitation, commune, especes, message, statut, source",
    )
    .order("created_at", { ascending: false });
  if (error) {
    console.error(
      `[PRODUCER_INTERESTS_FETCH_ERROR] error=${error.message}`,
    );
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as AdminProducerInterestRow[];
}

export async function getProducerInterest(
  admin: SupabaseClient,
  id: string,
): Promise<AdminProducerInterestRow | null> {
  const { data, error } = await admin
    .from("producer_interests")
    .select(
      "id, created_at, prenom, nom, email, telephone, nom_exploitation, commune, especes, message, statut, source",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(
      `[PRODUCER_INTEREST_GET_ERROR] id=${id} error=${error.message}`,
    );
    throw new Error(error.message);
  }
  return (data as AdminProducerInterestRow | null) ?? null;
}
