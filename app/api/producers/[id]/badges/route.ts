import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface RouteContext {
  params: { id: string };
}

// PATCH /api/producers/[id]/badges — recalcul des 3 scores pour UN producteur.
// Un cron hebdomadaire appelle cette route en boucle sur chaque producer.id.
export async function PATCH(request: Request, { params }: RouteContext) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();

  // Fenêtre glissante de 12 mois
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);

  const { data: orders } = await admin
    .from("orders")
    .select(
      "id, statut, created_at, confirmed_at, cancellation_reason",
    )
    .eq("producer_id", params.id)
    .gte("created_at", cutoff.toISOString());

  if (!orders || orders.length === 0) {
    return NextResponse.json({ producer_id: params.id, reason: "no_orders" });
  }

  const total = orders.length;
  const cancelledStock = orders.filter(
    (o) => o.cancellation_reason === "stock",
  ).length;
  const cancelled = orders.filter(
    (o) => o.statut === "cancelled" || o.statut === "refunded",
  ).length;
  const confirmed = orders.filter((o) => o.confirmed_at !== null);
  const fastConfirmed = confirmed.filter((o) => {
    if (!o.created_at || !o.confirmed_at) return false;
    return (
      new Date(o.confirmed_at).getTime() - new Date(o.created_at).getTime() <=
      2 * 60 * 60 * 1000
    );
  }).length;

  const pct = (x: number, y: number) =>
    y === 0 ? 100 : Math.round(((x / y) * 100) * 100) / 100;

  const scores = {
    badge_stock_score: pct(total - cancelledStock, total),
    badge_confirmation_score: pct(fastConfirmed, Math.max(confirmed.length, 1)),
    badge_annulation_score: pct(total - cancelled, total),
  };

  const { error } = await admin
    .from("producers")
    .update(scores)
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    producer_id: params.id,
    total_orders: total,
    ...scores,
  });
}
