import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recomputeBadgesForProducer } from "@/lib/producers/recompute-badges";

// Cron hebdomadaire — recompute des 3 scores badges pour chaque producteur
// actif. Séquentiel pour rester simple et éviter la pression DB ; à batcher
// si le nombre de producteurs grossit. Appel direct au helper depuis T-417
// (suppression de l'ancien proxy fetch HTTP interne avec Bearer manuel).
export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const { data: producers, error } = await admin
    .from("producers")
    .select("id")
    .eq("statut", "active");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!producers || producers.length === 0) {
    return NextResponse.json({ processed: 0, errors: [] });
  }

  const errors: Array<{ producer_id: string; error: string }> = [];
  let processed = 0;

  for (const p of producers) {
    try {
      const res = await recomputeBadgesForProducer(admin, p.id);
      if (res.error) {
        errors.push({ producer_id: p.id, error: res.error });
      } else {
        processed += 1;
      }
    } catch (e) {
      errors.push({
        producer_id: p.id,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return NextResponse.json({ processed, errors });
}

export const GET = POST;
