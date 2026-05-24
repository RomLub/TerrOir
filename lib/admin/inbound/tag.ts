import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import type { InboundTag } from "./types";

// Chantier 9 — tag automatique d'un email entrant par lookup de l'expéditeur :
//   1. public.users : rôle producer → 'producteur', sinon → 'consommateur'.
//   2. sinon producer_interests (lead = futur producteur) → 'producteur'.
//   3. sinon (inconnu) → 'public'.

export type InboundTagResult = {
  tag: InboundTag;
  lookupUserId: string | null;
  lookupLeadId: string | null;
};

export async function resolveInboundTag(
  admin: SupabaseClient,
  fromEmail: string,
): Promise<InboundTagResult> {
  const email = escapeIlikeEmail(fromEmail.trim().toLowerCase());

  const { data: user } = await admin
    .from("users")
    .select("id, roles")
    .ilike("email", email)
    .maybeSingle();
  if (user) {
    const roles = ((user as { roles: string[] | null }).roles ?? []) as string[];
    return {
      tag: roles.includes("producer") ? "producteur" : "consommateur",
      lookupUserId: (user as { id: string }).id,
      lookupLeadId: null,
    };
  }

  const { data: lead } = await admin
    .from("producer_interests")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (lead) {
    return {
      tag: "producteur",
      lookupUserId: null,
      lookupLeadId: (lead as { id: string }).id,
    };
  }

  return { tag: "public", lookupUserId: null, lookupLeadId: null };
}
