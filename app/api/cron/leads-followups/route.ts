import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runLeadsFollowups } from "@/lib/leads/relances";

// POST /api/cron/leads-followups (cron quotidien, cf. vercel.json).
//
// Relances auto (R1 J+3 / R2 J+10 / R3 J+20) des leads spontanés + abandon
// auto J+40. Auth Bearer CRON_SECRET (lib/cron/auth.ts). Logique métier
// déléguée à lib/leads/relances.ts (testable, idempotente).
//
// POST + export GET = POST : Vercel cron déclenche en GET par défaut.

export const maxDuration = 60;

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const result = await runLeadsFollowups(admin);

  console.log(
    `[CRON_LEADS_FOLLOWUPS] relances_sent=${result.relancesSent} ` +
      `abandoned=${result.abandoned} errors=${result.errors.length}`,
  );

  return NextResponse.json(result, {
    status: result.errors.length > 0 ? 500 : 200,
  });
}

export const GET = POST;
