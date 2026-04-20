import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processWeeklyPayouts } from "@/lib/stripe/payouts";
import { sendTemplate } from "@/lib/resend/send";
import PayoutSummary, {
  subject as payoutSubject,
  type PayoutOrderLine,
} from "@/lib/resend/templates/payout-summary";

// Lundi 8h — traite les virements hebdomadaires ET envoie l'email
// récapitulatif à chaque producteur concerné.
export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const { start, end, results } = await processWeeklyPayouts();

  let emailed = 0;

  for (const r of results) {
    // Skip les doublons idempotents et les échecs (pas d'email confus).
    if (r.skipped === "already_exists" || r.error) continue;

    const { data: producer } = await admin
      .from("producers")
      .select("nom_exploitation, user_id")
      .eq("id", r.producer_id)
      .maybeSingle();
    if (!producer?.user_id) continue;

    const { data: owner } = await admin
      .from("users")
      .select("email")
      .eq("id", producer.user_id)
      .maybeSingle();
    if (!owner?.email) continue;

    const orderLines: PayoutOrderLine[] = r.orders.map((o) => ({
      codeCommande: o.code_commande,
      dateRetrait: o.date_retrait,
      montantBrut: Number(o.montant_total),
      commission: Number(o.commission_terroir),
      montantNet: Number(o.montant_net_producteur),
    }));

    const props = {
      periodeDebut: r.periodeDebut,
      periodeFin: r.periodeFin,
      orders: orderLines,
      montantBrut: r.montantBrut,
      commission: r.commission,
      montantNet: r.montantNet,
    };

    const result = await sendTemplate({
      to: owner.email,
      userId: producer.user_id,
      template: "payout_summary",
      subject: payoutSubject(props),
      element: <PayoutSummary {...props} />,
      metadata: { payout_id: r.payout_id, producer_id: r.producer_id },
    });
    if (result.ok) emailed += 1;
  }

  return NextResponse.json({
    processed: results.length,
    emailed,
    start: start.toISOString(),
    end: end.toISOString(),
  });
}

export const GET = POST;
