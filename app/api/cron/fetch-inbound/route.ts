import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pollInbound } from "@/lib/admin/inbound/imap-fetch";

// POST /api/cron/fetch-inbound — chantier 9. Polling IMAP des emails entrants
// (cf. ADR-0010). Auth : Bearer CRON_SECRET.
//
// ⚠️ DÉSACTIVÉ PAR DÉFAUT (point Romain) : tant que INBOUND_EMAIL_CRON_ENABLED
// !== "true", la route ne fait RIEN (short-circuit). Romain l'active
// manuellement APRÈS avoir renseigné les identifiants IMAP et fait un test —
// évite un spam de retries sur le serveur IMAP OVH si les creds sont mauvais.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  if (process.env.INBOUND_EMAIL_CRON_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "cron_disabled" });
  }

  const admin = createSupabaseAdminClient();
  const results = await pollInbound(admin);

  const hadError = results.some((r) => r.error);
  if (hadError) {
    for (const r of results) {
      if (r.error) {
        console.error(`[INBOUND_FETCH_ERR] account=${r.account} error=${r.error}`);
      }
    }
  }

  return NextResponse.json({ ok: true, results }, { status: hadError ? 207 : 200 });
}
