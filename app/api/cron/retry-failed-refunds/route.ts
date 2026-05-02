import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { retryIncident, type RetryIncidentResult } from "@/lib/refund-incidents/retry-incident";
import type { RefundKind } from "@/lib/refund-incidents/types";

// Cron daily Vercel `0 4 * * *` (4h UTC, soit 5-6h Paris hors heures de
// pointe). Tente de re-rembourser les orders dont le refund initial a
// échoué sur n'importe lequel des 3 paths refund retry-able :
//   - revival : handle-payment-succeeded (kind='revival')
//   - admin   : /api/stripe/refund (kind='admin')
//   - timeout : cron order-timeout (kind='timeout')
//
// T-102.2.c — bascule depuis l'ancien modèle audit_logs-driven (compteurs
// JS via buildRetryTargets) vers refund_incidents source-of-truth (T-102.1
// tables, T-102.2.b RPC record_refund_attempt). Filtre SQL natif indexable,
// classification d'erreurs Stripe (T-102.2.a classify-error) avec
// court-circuit permanent géré par la RPC.
//
// Algorithme :
//   1. SELECT refund_incidents WHERE status IN ('pending','retrying')
//      AND retry_count < max_retries ORDER BY first_failed_event_at ASC
//      LIMIT 1000 (FIFO, plus ancien d'abord, équitable).
//   2. Pour chaque incident : retryIncident(...) → délègue Stripe call +
//      record_refund_attempt + UPDATE closure_reason si revival success +
//      INSERT notification placeholder si exhausted.
//
// Auth : header `Authorization: Bearer ${CRON_SECRET}` via assertCronAuth.
//
// Limite 1000 : volume cumulé attendu très faible. Tape la limite = signal
// d'incident plus large (Stripe down, RGPD purge massive en cours, etc.) —
// à monitorer en T-102.6 (chantier futur).

type IncidentRow = {
  id: string;
  order_id: string;
  kind: string;
  payment_intent_id: string;
  consumer_id: string | null;
  blocked_reason: string | null;
  retry_count: number;
  max_retries: number;
};

type ProcessedResult = {
  incident_id: string;
  order_id: string;
  kind: string;
  result: RetryIncidentResult;
};

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();

  // PostgREST ne permet pas de comparer 2 colonnes (retry_count < max_retries).
  // On récupère tous les status non-terminaux et on filtre côté JS. Volume
  // attendu très faible (<<1000 rows en prod), coût négligeable.
  const { data: incidents, error } = await admin
    .from("refund_incidents")
    .select(
      "id, order_id, kind, payment_intent_id, consumer_id, blocked_reason, retry_count, max_retries",
    )
    .in("status", ["pending", "retrying"])
    .order("first_failed_event_at", { ascending: true })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((incidents ?? []) as IncidentRow[]).filter(
    (r) => r.retry_count < r.max_retries,
  );

  if (rows.length === 0) {
    return NextResponse.json({ processed: 0, results: [] });
  }

  const results: ProcessedResult[] = [];

  for (const incident of rows) {
    // Defensive : si kind n'est pas un RefundKind valide, on skip (la table
    // a un CHECK kind IN ('revival','admin','timeout') donc ne devrait pas
    // arriver, mais le cast TS impose un check runtime).
    if (
      incident.kind !== "revival" &&
      incident.kind !== "admin" &&
      incident.kind !== "timeout"
    ) {
      console.warn(
        `[REFUND_RETRY_SKIP_BAD_KIND] incident=${incident.id} order=${incident.order_id} kind=${incident.kind}`,
      );
      continue;
    }
    const kind: RefundKind = incident.kind;

    // Defensive : blocked_reason doit être valide pour kind='revival'. Si
    // null sur kind='revival' (ne devrait pas arriver, posé par T-102.2.b),
    // on skip pour ne pas crasher l'UPDATE closure_reason côté helper.
    let blockedReason: "blocked_stock" | "blocked_slot" | null = null;
    if (
      incident.blocked_reason === "blocked_stock" ||
      incident.blocked_reason === "blocked_slot"
    ) {
      blockedReason = incident.blocked_reason;
    }
    if (kind === "revival" && blockedReason === null) {
      console.warn(
        `[REFUND_RETRY_SKIP_BAD_BLOCKED] incident=${incident.id} order=${incident.order_id} blocked=${incident.blocked_reason ?? "null"}`,
      );
      continue;
    }

    // Helper retry est resilient : tous les chemins d'erreur sont catchés
    // côté retryIncident. On wrap quand même dans un try/catch global pour
    // ne jamais casser la boucle batch (1 incident foireux ne doit pas
    // bloquer les autres).
    let result: RetryIncidentResult;
    try {
      result = await retryIncident({
        incidentId: incident.id,
        orderId: incident.order_id,
        kind,
        paymentIntentId: incident.payment_intent_id,
        consumerId: incident.consumer_id,
        blockedReason,
        retryCount: incident.retry_count,
        admin,
      });
    } catch (helperException) {
      console.error(
        `[REFUND_RETRY_HELPER_CRASH] incident=${incident.id} order=${incident.order_id} kind=${kind} exception=${(helperException as Error).message}`,
      );
      result = "failed_will_retry";
    }

    results.push({
      incident_id: incident.id,
      order_id: incident.order_id,
      kind,
      result,
    });
  }

  return NextResponse.json({ processed: results.length, results });
}

export const GET = POST;
