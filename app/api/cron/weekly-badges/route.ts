import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recomputeBadgesForProducer } from "@/lib/producers/recompute-badges";
import { mapWithConcurrency } from "@/lib/concurrency/p-limit";
import { dbErrorResponse } from "@/lib/api/db-error-response";

// Cron hebdomadaire — recompute des 3 scores badges pour chaque producteur
// actif. Audit RPC M-1 : passage de boucle séquentielle à mapWithConcurrency
// (cap 10, opération DB-only — pas d'appel externe). Appel direct au helper
// depuis T-417 (suppression de l'ancien proxy fetch HTTP interne avec
// Bearer manuel).

export const maxDuration = 60;

const DB_CONCURRENCY = 10;

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  // Filtre aligné sur la doctrine statuts producteur actuelle :
  // `draft` (créé, pas encore complété) / `pending` (publication demandée,
  // attente admin) / `public` (en ligne). L'ancien filtre `statut='active'`
  // datait d'une version pré-doctrine et matchait 0 producteur → cron mort
  // silencieusement depuis. Cf. audit scoring 2026-05-28.
  const { data: producers, error } = await admin
    .from("producers")
    .select("id")
    .in("statut", ["draft", "pending", "public"]);

  if (error) {
    return dbErrorResponse(error, "CRON_WEEKLY_BADGES_SELECT");
  }
  if (!producers || producers.length === 0) {
    return NextResponse.json({ processed: 0, errors: [] });
  }

  const settled = await mapWithConcurrency(
    producers,
    DB_CONCURRENCY,
    (p) => recomputeBadgesForProducer(admin, p.id),
  );

  const errors: Array<{ producer_id: string; error: string }> = [];
  let processed = 0;

  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]!;
    const p = producers[i]!;
    if (r.status === "rejected") {
      errors.push({
        producer_id: p.id,
        error: r.reason instanceof Error ? r.reason.message : "unknown",
      });
    } else if (r.value.error) {
      errors.push({ producer_id: p.id, error: r.value.error });
    } else {
      processed += 1;
    }
  }

  return NextResponse.json({ processed, errors });
}

export const GET = POST;
