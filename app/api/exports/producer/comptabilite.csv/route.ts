import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import {
  consumeRateLimit,
  getExportComptaRateLimit,
} from "@/lib/rate-limit";
import { parsePeriodParams, formatPeriodForFilename } from "@/lib/exports/period";
import { serializeRowsToCsv, maskEmailForExport } from "@/lib/exports/csv";

// GET /api/exports/producer/comptabilite.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Export comptable côté producer : commandes confirmées/complétées avec
// montants HT, commission TerrOir 6%, payout net, lien Stripe payout.
// Scope strict producer_id du producer authentifié (pas de cross-account).
//
// Date filtrée : completed_at (validation pickup) car c'est la date de
// reconnaissance du revenu côté producer (livré, validé). Tant qu'une
// commande est 'confirmed' (payée mais pas encore retirée), elle n'est pas
// dans l'export comptable producer — comportement décidé pour aligner avec
// la pratique comptable française (TVA exigible à la livraison).
//
// NB : email consumer masqué (j***@d***.fr) — defense-in-depth RGPD
// (l'export CSV peut sortir vers un comptable externe). Cohérent doctrine
// T-200 r1 (pas de PII dans les exports producer).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const limiter = getExportComptaRateLimit();
  const rateResult = await consumeRateLimit(limiter, `producer:${session.id}`);
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

  // Lookup producer_id de la session — guard d'accès et scope filtre query.
  const { data: producer, error: producerError } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();
  if (producerError) {
    return NextResponse.json({ error: producerError.message }, { status: 500 });
  }
  if (!producer) {
    return NextResponse.json(
      { error: "Profil producteur introuvable" },
      { status: 403 },
    );
  }

  const { data, error } = await admin
    .from("orders")
    .select(
      `id, completed_at, statut, montant_total, commission_terroir, montant_net_producteur,
       consumer:users!consumer_id(email)`,
    )
    .eq("producer_id", producer.id)
    .eq("statut", "completed")
    .gte("completed_at", periodResult.period.fromIso)
    .lte("completed_at", periodResult.period.toEndOfDayIso)
    .order("completed_at", { ascending: true })
    .limit(5000);

  if (error) {
    return dbErrorResponse(error, "EXPORT_PRODUCER_COMPTA_ERR", {
      producer_id: producer.id,
    });
  }

  // Pour rapprocher les payouts Stripe : lookup payouts qui couvrent la
  // période. La table payouts est indexée par (producer_id, periode_debut/
  // periode_fin) — on récupère ceux qui chevauchent la période demandée
  // pour annoter chaque commande avec son stripe_payout_id le cas échéant.
  // En MVP : on ne join PAS ligne-à-ligne (un payout = N commandes
  // agrégées sur la semaine, pas une 1-1 mapping). On expose le payout_id
  // associé à la SEMAINE de completed_at (best-effort).
  const { data: payouts } = await admin
    .from("payouts")
    .select("id, periode_debut, periode_fin, stripe_payout_id")
    .eq("producer_id", producer.id)
    .gte("periode_fin", periodResult.period.fromIso.slice(0, 10))
    .lte("periode_debut", periodResult.period.toEndOfDayIso.slice(0, 10));

  type Payout = {
    periode_debut: string;
    periode_fin: string;
    stripe_payout_id: string | null;
  };
  function findPayoutForDate(dateIso: string | null): string {
    if (!dateIso) return "";
    const dateOnly = dateIso.slice(0, 10);
    const match = (payouts ?? []).find(
      (p: Payout) => p.periode_debut <= dateOnly && p.periode_fin >= dateOnly,
    );
    return match?.stripe_payout_id ?? "";
  }

  type Row = {
    id: string;
    completed_at: string | null;
    statut: string;
    montant_total: number | null;
    commission_terroir: number | null;
    montant_net_producteur: number | null;
    consumer: { email: string | null } | { email: string | null }[] | null;
  };
  const rows = ((data ?? []) as Row[]).map((r) => {
    const consumer = Array.isArray(r.consumer) ? r.consumer[0] : r.consumer;
    return {
      commande_id: r.id,
      date_validation: r.completed_at ? r.completed_at.slice(0, 10) : "",
      consumer_email_masked: maskEmailForExport(consumer?.email ?? null),
      montant_produits: formatEuros(r.montant_net_producteur),
      commission_terroir_6pct: formatEuros(r.commission_terroir),
      payout_net: formatEuros(r.montant_net_producteur),
      stripe_payout_id: findPayoutForDate(r.completed_at),
    };
  });

  const csv = serializeRowsToCsv(rows, [
    { key: "commande_id", header: "commande_id" },
    { key: "date_validation", header: "date_validation" },
    { key: "consumer_email_masked", header: "consumer_email_masked" },
    { key: "montant_produits", header: "montant_produits" },
    { key: "commission_terroir_6pct", header: "commission_terroir_6%" },
    { key: "payout_net", header: "payout_net" },
    { key: "stripe_payout_id", header: "stripe_payout_id" },
  ]);

  const filename = `comptabilite_producer_${formatPeriodForFilename({
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

function formatEuros(value: number | null): string {
  if (value === null) return "";
  return value.toFixed(2);
}
