import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import {
  consumeRateLimit,
  getExportComptaRateLimit,
} from "@/lib/rate-limit";
import {
  parsePeriodParams,
  formatPeriodForFilename,
  formatDateInExportTimezone,
} from "@/lib/exports/period";
import { serializeRowsToCsv } from "@/lib/exports/csv";

// GET /api/exports/consumer/comptabilite.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Export comptable côté consumer : liste des commandes payées sur la
// période, avec montants et commission TerrOir. Scope par session
// (auth.uid() = consumer_id strict, pas de cross-account access).
//
// Inclus : toutes les commandes dont le created_at est dans [from, to]
// ET dont statut ∈ ('confirmed', 'completed', 'cancelled' avec
// closure_reason 'producer_refused'/'consumer_cancelled' qui ont quand
// même un débit Stripe). On n'inclut PAS les commandes 'pending' (pas
// encore validées producer) ni 'cancelled' avec closure_reason
// 'payment_failed' / 'revival_blocked_*' (jamais débitées) — pour le
// consumer ce sont des transactions sans impact comptable.
//
// Pas de scope sur date_retrait : la date comptable consumer est la
// date de la commande (date_commande = created_at), pas la date de
// retrait physique. Cohérent avec un export bancaire (la facture est
// datée à la commande, pas à la livraison).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAID_STATUSES = ["confirmed", "completed"] as const;

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const limiter = getExportComptaRateLimit();
  const rateResult = await consumeRateLimit(limiter, `consumer:${session.id}`);
  if (!rateResult.success) {
    return NextResponse.json(
      { error: "Trop de requêtes" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rateResult.reset - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const url = new URL(request.url);
  const periodResult = parsePeriodParams({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!periodResult.ok) {
    return NextResponse.json({ error: periodResult.error }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, created_at, statut, montant_total, commission_terroir, montant_net_producteur, producer:producers!inner(nom_exploitation)",
    )
    .eq("consumer_id", session.id)
    .gte("created_at", periodResult.period.fromIso)
    .lte("created_at", periodResult.period.toEndOfDayIso)
    .in("statut", [...PAID_STATUSES])
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) {
    return dbErrorResponse(error, "EXPORT_CONSUMER_COMPTA_ERR", {
      user_id: session.id,
    });
  }

  type Row = {
    id: string;
    created_at: string;
    statut: string;
    montant_total: number | null;
    commission_terroir: number | null;
    montant_net_producteur: number | null;
    producer: { nom_exploitation: string | null } | { nom_exploitation: string | null }[] | null;
  };
  const rows = ((data ?? []) as Row[]).map((r) => {
    // PostgREST embed peut renvoyer un array (1-N) ou un objet (1-1) selon
    // la résolution. On normalise pour prendre le 1er producer.
    const producer = Array.isArray(r.producer) ? r.producer[0] : r.producer;
    return {
      commande_id: r.id,
      date_commande: formatDateInExportTimezone(r.created_at),
      producteur_nom: producer?.nom_exploitation ?? "",
      // Décomposition : montant_total = montant_net_producteur + commission_terroir.
      // montant_produits côté consumer = montant des produits eux-mêmes (HT
      // producer-side, soit montant_net_producteur). La commission TerrOir
      // est isolée dans sa propre colonne pour traçabilité comptable.
      montant_produits: formatEuros(r.montant_net_producteur),
      commission_terroir: formatEuros(r.commission_terroir),
      total_paye: formatEuros(r.montant_total),
    };
  });

  const csv = serializeRowsToCsv(rows, [
    { key: "commande_id", header: "commande_id" },
    { key: "date_commande", header: "date_commande" },
    { key: "producteur_nom", header: "producteur_nom" },
    { key: "montant_produits", header: "montant_produits" },
    { key: "commission_terroir", header: "commission_terroir" },
    { key: "total_paye", header: "total_paye" },
  ]);

  const filename = `comptabilite_consumer_${formatPeriodForFilename({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  })}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// Formatage montant en euros texte avec 2 décimales (séparateur '.' point
// décimal anglo-saxon, conforme aux outils comptables internationaux et
// au parsing Pandas/Sage par défaut).
function formatEuros(value: number | null): string {
  if (value === null) return "";
  return value.toFixed(2);
}
