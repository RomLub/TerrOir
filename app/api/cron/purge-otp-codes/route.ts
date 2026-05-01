import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// POST /api/cron/purge-otp-codes (cron daily 5h UTC, cf. vercel.json).
//
// Purge les rows OTP de email_change_otp_codes qui ne servent plus :
//   1. consumed_at IS NOT NULL AND created_at < now() - 7 jours → DELETE
//      (codes déjà consommés, plus aucune utilité après 7j).
//   2. consumed_at IS NULL AND expires_at < now() AND created_at < now()
//      - 7 jours → DELETE (codes expirés non consommés qui traînent ;
//      filtre created_at est defense-in-depth : un OTP expiré récent
//      <7j reste protégé contre une éventuelle fenêtre forensique).
//
// Pattern aligné app/api/cron/purge-stock-alerts/route.ts (2 DELETEs
// distincts avec count: "exact" pour avoir un compteur par bucket).
//
// Auth Bearer CRON_SECRET (pattern lib/cron/auth.ts).

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  // 1. Purge des codes consommés > 7 jours
  const { count: purgedConsumed, error: consumedError } = await admin
    .from("email_change_otp_codes")
    .delete({ count: "exact" })
    .not("consumed_at", "is", null)
    .lt("created_at", sevenDaysAgo);

  if (consumedError) {
    console.error(
      `[CRON_PURGE_OTP] consumed_error error=${consumedError.message}`,
    );
  }

  // 2. Purge des codes expirés non consommés > 7 jours
  const { count: purgedExpired, error: expiredError } = await admin
    .from("email_change_otp_codes")
    .delete({ count: "exact" })
    .is("consumed_at", null)
    .lt("expires_at", nowIso)
    .lt("created_at", sevenDaysAgo);

  if (expiredError) {
    console.error(
      `[CRON_PURGE_OTP] expired_error error=${expiredError.message}`,
    );
  }

  console.log(
    `[CRON_PURGE_OTP] purged_consumed=${purgedConsumed ?? 0} purged_expired=${purgedExpired ?? 0}`,
  );

  return NextResponse.json({
    purged_consumed: purgedConsumed ?? 0,
    purged_expired: purgedExpired ?? 0,
    consumed_error: consumedError?.message ?? null,
    expired_error: expiredError?.message ?? null,
  });
}

// Vercel cron déclenche les routes via GET par défaut.
export const GET = POST;
