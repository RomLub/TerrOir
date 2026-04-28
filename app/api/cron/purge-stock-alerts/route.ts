import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// POST /api/cron/purge-stock-alerts (cron daily 3am UTC, cf. vercel.json).
//
// Purge RGPD pour la table product_stock_alerts (cf. arbitrage F PUSH 1) :
//   1. notified_at < now() - 90 jours → DELETE (alertes notifiées il y a
//      plus de 90 jours, donnée perso non conservée au-delà).
//   2. confirmed_at IS NULL AND created_at < now() - 7 jours → DELETE
//      (alertes abandonnées : double opt-in non complété, pas de raison
//      de garder l'email en base).
//
// Pas de purge des alertes unsubscribed actives : on garde la row pour
// que le user puisse cliquer le lien unsubscribe depuis un vieil email
// archivé ; sera purgée naturellement quand notified_at se setterait,
// mais comme un unsubscribed ne peut plus être notifié, ces rows
// pourraient s'accumuler. Décision : ne pas les purger pour l'instant
// (volume faible attendu, pattern aligné convention RGPD "respecter
// l'opt-out le plus strictement possible" — l'email reste pour le
// re-subscribe via résurrection helper).
//
// Auth Bearer CRON_SECRET (pattern lib/cron/auth.ts).

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const now = Date.now();

  // 1. Purge notified > 90 jours
  const ninetyDaysAgo = new Date(now - NINETY_DAYS_MS).toISOString();
  const { count: purgedNotified, error: notifiedError } = await admin
    .from("product_stock_alerts")
    .delete({ count: "exact" })
    .not("notified_at", "is", null)
    .lt("notified_at", ninetyDaysAgo);

  if (notifiedError) {
    console.error(
      `STOCK_ALERT_PURGE_NOTIFIED_ERROR error=${notifiedError.message}`,
    );
  }

  // 2. Purge unconfirmed > 7 jours
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
  const { count: purgedUnconfirmed, error: unconfirmedError } = await admin
    .from("product_stock_alerts")
    .delete({ count: "exact" })
    .is("confirmed_at", null)
    .lt("created_at", sevenDaysAgo);

  if (unconfirmedError) {
    console.error(
      `STOCK_ALERT_PURGE_UNCONFIRMED_ERROR error=${unconfirmedError.message}`,
    );
  }

  return NextResponse.json({
    purged_notified: purgedNotified ?? 0,
    purged_unconfirmed: purgedUnconfirmed ?? 0,
    notified_error: notifiedError?.message ?? null,
    unconfirmed_error: unconfirmedError?.message ?? null,
  });
}

// Vercel cron déclenche les routes via GET par défaut. Pattern aligné
// app/api/cron/order-timeout/route.tsx ligne 139.
export const GET = POST;
