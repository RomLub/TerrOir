import "server-only";
import { stripe } from "./server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Calcule la plage lundi 00:00 → dimanche 23:59:59.999 UTC de la semaine
// précédant la date du jour.
// =============================================================================
export function previousWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisMonday = new Date(now);
  thisMonday.setUTCDate(now.getUTCDate() - daysSinceMonday);
  thisMonday.setUTCHours(0, 0, 0, 0);
  const start = new Date(thisMonday);
  start.setUTCDate(thisMonday.getUTCDate() - 7);
  const end = new Date(thisMonday);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

export interface OrderRow {
  id: string;
  code_commande: string;
  date_retrait: string | null;
  producer_id: string;
  montant_total: number;
  commission_terroir: number;
  montant_net_producteur: number;
}

export interface PayoutResult {
  producer_id: string;
  payout_id: string | null;
  stripe_transfer_id: string | null;
  orders: OrderRow[];
  montantBrut: number;
  commission: number;
  montantNet: number;
  periodeDebut: string;
  periodeFin: string;
  skipped?: "already_exists";
  error?: string;
}

// =============================================================================
// Agrège les commandes completed de la semaine précédente par producteur,
// crée un enregistrement public.payouts (idempotent par (producer,week)) et
// déclenche stripe.transfers.create() vers le compte Connect.
// =============================================================================
export async function processWeeklyPayouts(): Promise<{
  start: Date;
  end: Date;
  results: PayoutResult[];
}> {
  const { start, end } = previousWeekRange();
  const periodeDebut = start.toISOString().slice(0, 10);
  const periodeFin = end.toISOString().slice(0, 10);

  const admin = createSupabaseAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select(
      "id, code_commande, date_retrait, producer_id, montant_total, commission_terroir, montant_net_producteur",
    )
    .eq("statut", "completed")
    .gte("completed_at", start.toISOString())
    .lte("completed_at", end.toISOString());

  const safeOrders = (orders ?? []) as OrderRow[];

  if (safeOrders.length === 0) {
    return { start, end, results: [] };
  }

  const groups = new Map<string, OrderRow[]>();
  for (const o of safeOrders) {
    const list = groups.get(o.producer_id) ?? [];
    list.push(o);
    groups.set(o.producer_id, list);
  }

  const results: PayoutResult[] = [];

  for (const [producerId, producerOrders] of groups) {
    const montantBrut = producerOrders.reduce(
      (s, o) => s + Number(o.montant_total),
      0,
    );
    const commission = producerOrders.reduce(
      (s, o) => s + Number(o.commission_terroir),
      0,
    );
    const montantNet = producerOrders.reduce(
      (s, o) => s + Number(o.montant_net_producteur),
      0,
    );

    const { data: existing } = await admin
      .from("payouts")
      .select("id")
      .eq("producer_id", producerId)
      .eq("periode_debut", periodeDebut)
      .maybeSingle();

    if (existing) {
      results.push({
        producer_id: producerId,
        payout_id: existing.id,
        stripe_transfer_id: null,
        orders: producerOrders,
        montantBrut,
        commission,
        montantNet,
        periodeDebut,
        periodeFin,
        skipped: "already_exists",
      });
      continue;
    }

    const { data: producer } = await admin
      .from("producers")
      .select("stripe_account_id, stripe_payouts_enabled")
      .eq("id", producerId)
      .maybeSingle();

    let stripeTransferId: string | null = null;
    let errorMsg: string | undefined;

    // Gate sur stripe_payouts_enabled en plus de stripe_account_id :
    // avoir un account.id ne garantit pas que le compte soit prêt à
    // recevoir des virements (KYC peut être incomplet). Évite un échec
    // API Stripe silencieux et aligne la sémantique avec /parametres.
    if (producer?.stripe_account_id && producer.stripe_payouts_enabled) {
      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(montantNet * 100),
          currency: "eur",
          destination: producer.stripe_account_id,
          metadata: {
            producer_id: producerId,
            periode_debut: periodeDebut,
            periode_fin: periodeFin,
          },
        });
        stripeTransferId = transfer.id;
      } catch (e) {
        errorMsg = (e as Error).message;
      }
    } else if (producer?.stripe_account_id) {
      // Compte Stripe créé mais onboarding incomplet — audit trail.
      console.warn(
        `[PAYOUT_SKIP_NOT_READY] producer_id=${producerId} stripe_account_id=${producer.stripe_account_id} reason=payouts_not_enabled`,
      );
      errorMsg = "Producer Stripe account not ready for payouts";
    } else {
      errorMsg = "Producer has no stripe_account_id";
    }

    const { data: payoutRow, error: insertError } = await admin
      .from("payouts")
      .insert({
        producer_id: producerId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        montant_brut: montantBrut,
        commission,
        montant_net: montantNet,
        stripe_transfer_id: stripeTransferId,
        statut: "pending",
      })
      .select("id")
      .single();

    results.push({
      producer_id: producerId,
      payout_id: payoutRow?.id ?? null,
      stripe_transfer_id: stripeTransferId,
      orders: producerOrders,
      montantBrut,
      commission,
      montantNet,
      periodeDebut,
      periodeFin,
      ...(errorMsg || insertError
        ? { error: errorMsg ?? insertError?.message }
        : {}),
    });
  }

  return { start, end, results };
}
