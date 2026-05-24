import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Résolution du producteur de l'utilisateur courant pour les server actions
// producteur (chantier 3 — plomberie). Renvoie { owner } ou { error }.
//
// SÉCURITÉ : l'id retourné est la SEULE source pour l'ownership des écritures
// — les actions filtrent `WHERE id = owner.id`, jamais sur un id fourni par le
// client. Le client service_role bypasse la RLS et le trigger
// producers_block_owner_admin_columns : c'est donc cet ownership + la liste
// blanche zod côté action qui constituent le garde-fou.

export type ProducerOwner = { id: string; slug: string; statut: string };

export async function resolveProducerOwner(
  userId: string,
): Promise<{ owner: ProducerOwner } | { error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("producers")
    .select("id, slug, statut")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { error: "Erreur lors de la résolution du profil." };
  if (!data) return { error: "Profil producteur introuvable." };

  return {
    owner: {
      id: data.id as string,
      slug: (data.slug as string | null) ?? "",
      statut: (data.statut as string | null) ?? "",
    },
  };
}
