import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { confirmStockAlert } from "@/lib/stock-alerts/confirm-alert";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// GET /api/stock-alerts/confirm?token=xxx
//
// Cliqué depuis l'email confirm (double opt-in). Valide le token via le
// helper confirm-alert (PUSH 2), puis redirige vers la page publique
// /alertes-stock/confirm avec un query param `status` qui détermine le
// rendu côté Server Component (success / invalid / expired / unsubscribed
// / already_confirmed).
//
// Pourquoi GET (pas POST) : convention "lien clicable depuis email" — un
// POST nécessiterait un form HTML interstitiel inutile pour un flux unique.
// Risque "prefetch déclenche le opt-in" minimisé : le confirm est idempotent
// (same alerte, same token) et ne révèle pas d'info sensible.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const admin = createSupabaseAdminClient();
  const result = await confirmStockAlert(admin, token);

  let status: string;
  if (result.ok) {
    status = result.data.already_confirmed ? "already_confirmed" : "success";
  } else {
    // db_error → on log mais on redirect quand même vers invalid pour
    // ne pas exposer les détails d'erreur au user. Le helper a déjà
    // log côté serveur.
    status = result.error === "db_error" ? "invalid" : result.error;
  }

  const target = `${NEXT_PUBLIC_APP_URL}/alertes-stock/confirm?status=${encodeURIComponent(status)}`;
  return NextResponse.redirect(target, { status: 303 });
}
