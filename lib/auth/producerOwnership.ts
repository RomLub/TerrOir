import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Renvoie l'id du producer dont `userId` est propriétaire, ou null.
export async function getOwnedProducerId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
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
