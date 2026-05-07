import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Renvoie l'id du producer dont `userId` est propriétaire, ou null.
//
// bugs-P2-2 (T9 2026-05-07) : fail-closed logging. Avant, une erreur de
// lookup (RLS bug, statement_timeout, schema drift) était silencieusement
// avalée par le `?? null`. Conséquence : la route appelante retournait 403
// Forbidden sans signal côté SRE pour distinguer "user pas producer"
// (normal) de "DB down" (incident). On loggue + on continue le fail-closed.
export async function getOwnedProducerId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error(
      `[OWNERSHIP_LOOKUP_ERR] user_id=${userId} error=${error.message}`,
    );
  }
  return (data?.id as string | undefined) ?? null;
}

export async function userOwnsProducer(
  admin: SupabaseClient,
  userId: string,
  producerId: string,
): Promise<boolean> {
  const owned = await getOwnedProducerId(admin, userId);
  return owned === producerId;
}
