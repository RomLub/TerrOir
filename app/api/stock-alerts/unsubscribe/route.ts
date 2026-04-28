import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { unsubscribeStockAlert } from "@/lib/stock-alerts/unsubscribe-alert";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// GET /api/stock-alerts/unsubscribe?token=xxx
//
// Cliqué depuis le footer de tous les emails stock-alerts (lien permanent,
// pas d'expiration cf. arbitrage F PUSH 1). Valide le token via le helper
// unsubscribe-alert (PUSH 2) puis redirige vers la page publique
// /alertes-stock/unsubscribe avec un query param `status`.
//
// Idempotent côté helper : double clic = ok (already_unsubscribed=true).
// Pas de form interstitiel POST (vs lib/rgpd/desabonnement, qui lui a un
// 2-step pour résister aux prefetchers email) : on accepte le risque de
// prefetch unsub car (1) le user peut toujours se ré-abonner depuis la
// fiche produit, (2) l'effet "ne plus recevoir d'emails" est conforme à
// son intention probable s'il a cliqué le lien.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const admin = createSupabaseAdminClient();
  const result = await unsubscribeStockAlert(admin, token);

  let status: string;
  if (result.ok) {
    status = result.data.already_unsubscribed ? "already_unsubscribed" : "success";
  } else {
    status = result.error === "db_error" ? "invalid" : result.error;
  }

  const target = `${NEXT_PUBLIC_APP_URL}/alertes-stock/unsubscribe?status=${encodeURIComponent(status)}`;
  return NextResponse.redirect(target, { status: 303 });
}
