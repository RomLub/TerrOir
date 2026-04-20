import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { processWeeklyPayouts } from "@/lib/stripe/payouts";

// =============================================================================
// Route legacy — déclenche le traitement des virements hebdomadaires
// sans envoi d'emails. Pour le flux complet (cron du lundi 8h avec emails
// récapitulatifs producteur), préférer /api/cron/weekly-payout.
// =============================================================================
export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const { start, end, results } = await processWeeklyPayouts();
  return NextResponse.json({
    processed: results.length,
    start: start.toISOString(),
    end: end.toISOString(),
    results: results.map((r) => ({
      producer_id: r.producer_id,
      payout_id: r.payout_id,
      stripe_transfer_id: r.stripe_transfer_id,
      skipped: r.skipped,
      error: r.error,
    })),
  });
}
