import "server-only";
import { waitUntil } from "@vercel/functions";
import { TZDate } from "@date-fns/tz";
import { stripe } from "./server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";
import { SUPPORT_EMAIL } from "@/lib/env/support-email";
import { eurosToCents, centsToEuros, sumCents } from "@/lib/money/cents";
import AdminTransferFailed, {
  subject as adminTransferFailedSubject,
} from "@/lib/resend/templates/admin-transfer-failed";

// =============================================================================
// Calcule la plage lundi 00:00 → dimanche 23:59:59.999 Europe/Paris de la
// semaine précédant la date du jour (bugs-P2-5, 2026-05-12).
//
// Référence locale française = perception civile producteur. Avant ce fix,
// le calcul UTC pure faisait tomber dans la semaine SUIVANTE une commande
// validée le dimanche 23h45 Paris (= lundi 21h45 UTC en hiver) — biais
// pour les producteurs travaillant dimanche soir.
//
// A re-valider post-Live volume-dependant : si l'analyse comptable
// producteur s'aligne en realite sur le calendrier Stripe (UTC) plutot
// que civil, revenir au calcul UTC. Decision pragmatique pre-Live :
// prioriser perception producteur francais.
// =============================================================================
const PAYOUT_TZ = "Europe/Paris";

// Formate un Date UTC en YYYY-MM-DD interprete dans la timezone donnee
// (locale civile, pas UTC). Utilise pour periodeDebut/periodeFin DB.
function formatYmdInTz(date: Date, tz: string): string {
  const tzd = new TZDate(date.getTime(), tz);
  const y = tzd.getFullYear();
  const m = String(tzd.getMonth() + 1).padStart(2, "0");
  const d = String(tzd.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function previousWeekRange(): { start: Date; end: Date } {
  const nowParis = TZDate.tz(PAYOUT_TZ);
  const dayOfWeek = nowParis.getDay(); // 0=dimanche … 6=samedi
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisMondayParis = new TZDate(nowParis.getTime(), PAYOUT_TZ);
  thisMondayParis.setDate(nowParis.getDate() - daysSinceMonday);
  thisMondayParis.setHours(0, 0, 0, 0);
  const startParis = new TZDate(thisMondayParis.getTime(), PAYOUT_TZ);
  startParis.setDate(thisMondayParis.getDate() - 7);
  const endParis = new TZDate(thisMondayParis.getTime(), PAYOUT_TZ);
  endParis.setMilliseconds(endParis.getMilliseconds() - 1);
  return {
    start: new Date(startParis.getTime()),
    end: new Date(endParis.getTime()),
  };
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
  resumed?: boolean;
  error?: string;
}

// =============================================================================
// Agrège les commandes completed de la semaine précédente par producteur,
// crée un enregistrement public.payouts (idempotent par (producer,week)) et
// déclenche stripe.transfers.create() vers le compte Connect.
//
// T-414 — séquence INSERT-before-transfer + idempotencyKey Stripe :
// La séquence historique (transfer-then-INSERT sans idempotencyKey) créait un
// drift permanent si le Stripe transfer réussissait mais l'INSERT DB échouait.
// Au prochain run cron, le check d'idempotence ne trouvait pas le row → relance
// le transfer → DOUBLE PAYOUT vers le producteur. Argent perdu côté plateforme.
//
// Nouvelle séquence (4 cas de crash documentés) :
//   (a) Crash avant INSERT 'processing'                 → prochain run = nominal
//   (b) Crash après INSERT 'processing', avant transfer → resume tente transfer
//                                                          (Stripe pas vu la 1re
//                                                          tentative, exécute)
//   (c) Crash après transfer succès, avant UPDATE 'paid'→ resume tente transfer
//                                                          avec MÊME idempotencyKey,
//                                                          Stripe renvoie le
//                                                          Transfer existant
//                                                          (pas de double),
//                                                          UPDATE 'paid' OK
//   (d) Crash après UPDATE 'paid'                       → check trouve 'paid' → skip
// =============================================================================
export async function processWeeklyPayouts(): Promise<{
  start: Date;
  end: Date;
  results: PayoutResult[];
}> {
  const { start, end } = previousWeekRange();
  // periodeDebut/Fin = date civile Paris (YYYY-MM-DD), pas la date UTC. Sinon
  // un lundi 00:00 Paris (CET = UTC+1) donnerait "...T23:00:00.000Z" la
  // veille → slice(0, 10) = dimanche, faux côté DB.
  const periodeDebut = formatYmdInTz(start, PAYOUT_TZ);
  const periodeFin = formatYmdInTz(end, PAYOUT_TZ);

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
    // T-415-suite : aggregations en cents pour précision arithmétique
    // (anti-drift IEEE 754 sur reduce 100+ orders avec montants
    // fractionnaires). Variables cents = source of truth pour Stripe API
    // + audit log T-416. Variables décimales dérivées via centsToEuros =
    // consommées par DB INSERT (numeric €), baseResult tuple (PayoutResult)
    // et Resend props (FR formatting admin_transfer_failed template).
    //
    // ⚠️ Sémantique sub-cent : sumCents() arrondit chaque item via
    // Math.round(* 100) AVANT la sum. Si des montants sub-cent (ex:
    // 0.018€ = 1.8 cents) entraient dans le reduce, sumCents bornerait
    // à 2 cents par item (pas 1.8). Ce comportement est cohérent avec
    // Stripe API (integer cents only).
    //
    // En prod, le trigger DB compute_order_commission (migration
    // 20260419000000) garantit cent-alignement (`round(montant_total *
    // 0.06, 2)`), donc les sub-cent ne peuvent pas exister via le flow
    // normal. Cette protection défensive est documentée pour les cas
    // hypothétiques (import manuel Dashboard, edge case bypass trigger).
    const montantBrutCents = sumCents(producerOrders.map((o) => o.montant_total));
    const commissionCents = sumCents(producerOrders.map((o) => o.commission_terroir));
    const montantNetCents = sumCents(producerOrders.map((o) => o.montant_net_producteur));
    const montantBrut = centsToEuros(montantBrutCents);
    const commission = centsToEuros(commissionCents);
    const montantNet = centsToEuros(montantNetCents);

    const baseResult = {
      producer_id: producerId,
      orders: producerOrders,
      montantBrut,
      commission,
      montantNet,
      periodeDebut,
      periodeFin,
    };

    // Check idempotence étendu : SELECT statut + montant_net pour résumes.
    // T-416 : montant_brut + commission ajoutés pour audit log forensique
    // post-UPDATE 'paid' resume (source of truth DB, vs recomputation
    // locale qui peut diverger après 3DS-retry resurrection orders).
    const { data: existing } = await admin
      .from("payouts")
      .select(
        "id, statut, stripe_transfer_id, montant_net, montant_brut, commission",
      )
      .eq("producer_id", producerId)
      .eq("periode_debut", periodeDebut)
      .maybeSingle();

    if (existing?.statut === "paid") {
      // Cas (d) — déjà fini.
      results.push({
        ...baseResult,
        payout_id: existing.id,
        stripe_transfer_id: existing.stripe_transfer_id,
        skipped: "already_exists",
      });
      continue;
    }

    if (existing?.statut === "failed") {
      // Cas défensif — n'apparaît qu'après merge bundle 3 TB (handlers
      // transfer.failed/payout.failed). On bloque le retry auto : un échec
      // côté Stripe→banque indique un problème de compte (KYC expiré,
      // banque rejette) qui exige intervention admin.
      results.push({
        ...baseResult,
        payout_id: existing.id,
        stripe_transfer_id: existing.stripe_transfer_id,
        error: "previously failed, manual review",
      });
      continue;
    }

    if (existing?.statut === "pending") {
      // Rows legacy ante-T-414. La séquence historique posait 'pending' avec
      // un stripe_transfer_id éventuellement non-null. Sans connaître l'état
      // réel côté Stripe, retry auto = risque double payout. Reflag T-424
      // pour script migration one-shot post-bundles.
      results.push({
        ...baseResult,
        payout_id: existing.id,
        stripe_transfer_id: existing.stripe_transfer_id,
        error: "legacy pending row, manual review (T-424)",
      });
      continue;
    }

    // Lecture producer pour stripe_account_id + payouts_enabled. Avant
    // INSERT (R1) pour ne pas créer de row 'processing' fantôme si le
    // producer n'est pas prêt à recevoir un transfer.
    const { data: producer } = await admin
      .from("producers")
      .select("stripe_account_id, stripe_payouts_enabled")
      .eq("id", producerId)
      .maybeSingle();

    if (!producer?.stripe_account_id) {
      results.push({
        ...baseResult,
        payout_id: null,
        stripe_transfer_id: null,
        error: "Producer has no stripe_account_id",
      });
      continue;
    }
    if (!producer.stripe_payouts_enabled) {
      console.warn(
        `[PAYOUT_SKIP_NOT_READY] producer_id=${producerId} stripe_account_id=${producer.stripe_account_id} reason=payouts_not_enabled`,
      );
      results.push({
        ...baseResult,
        payout_id: null,
        stripe_transfer_id: null,
        error: "Producer Stripe account not ready for payouts",
      });
      continue;
    }

    const idempotencyKey = `transfer_${producerId}_${periodeDebut}`;
    const transferMetadata = {
      producer_id: producerId,
      periode_debut: periodeDebut,
      periode_fin: periodeFin,
    };

    if (existing?.statut === "processing") {
      // Cas (b) ou (c) — resume. Montant lu depuis DB (source of truth
      // post-INSERT, immune aux changements d'orders entre INSERT et resume
      // ex. résurrection 3DS-retry).
      const resumeAmount = eurosToCents(existing.montant_net);
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: resumeAmount,
            currency: "eur",
            destination: producer.stripe_account_id,
            metadata: transferMetadata,
          },
          { idempotencyKey },
        );
        const { error: updateErr } = await admin
          .from("payouts")
          .update({ statut: "paid", stripe_transfer_id: transfer.id })
          .eq("id", existing.id);
        if (updateErr) {
          console.warn(
            `[WEEKLY_PAYOUT_RESUME_UPDATE_FAILED] payout=${existing.id} reason=${updateErr.message}`,
          );
          results.push({
            ...baseResult,
            payout_id: existing.id,
            stripe_transfer_id: transfer.id,
            error: `Resume UPDATE failed: ${updateErr.message}`,
          });
          continue;
        }
        // T-416 audit log forensique post-UPDATE 'paid' succès resume.
        // Montants depuis existing (source of truth DB, immune aux changements
        // d'orders entre INSERT initial et resume).
        await logPaymentEvent({
          eventType: "stripe_transfer_initiated",
          userId: null,
          metadata: {
            payout_id: existing.id,
            stripe_transfer_id: transfer.id,
            producer_id: producerId,
            periode_debut: periodeDebut,
            periode_fin: periodeFin,
            montant_brut_cents: eurosToCents(existing.montant_brut),
            commission_cents: eurosToCents(existing.commission),
            montant_net_cents: eurosToCents(existing.montant_net),
            currency: "eur",
            orders_count: producerOrders.length,
            resumed: true,
          },
        });
        results.push({
          ...baseResult,
          payout_id: existing.id,
          stripe_transfer_id: transfer.id,
          resumed: true,
        });
      } catch (transferErr) {
        const msg = (transferErr as Error).message;
        console.warn(
          `[WEEKLY_PAYOUT_RESUME_TRANSFER_FAILED] payout=${existing.id} reason=${msg}`,
        );
        results.push({
          ...baseResult,
          payout_id: existing.id,
          stripe_transfer_id: null,
          error: `Resume transfer failed: ${msg}`,
        });
      }
      continue;
    }

    // Pas d'existing — nouvelle séquence INSERT 'processing' AVANT transfer.
    const { data: newRow, error: insertErr } = await admin
      .from("payouts")
      .insert({
        producer_id: producerId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        montant_brut: montantBrut,
        commission,
        montant_net: montantNet,
        stripe_transfer_id: null,
        statut: "processing",
      })
      .select("id")
      .single();

    if (insertErr || !newRow) {
      results.push({
        ...baseResult,
        payout_id: null,
        stripe_transfer_id: null,
        error: `INSERT failed: ${insertErr?.message ?? "unknown"}`,
      });
      continue;
    }

    let transferId: string;
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: montantNetCents,
          currency: "eur",
          destination: producer.stripe_account_id,
          metadata: transferMetadata,
        },
        { idempotencyKey },
      );
      transferId = transfer.id;
    } catch (transferErr) {
      const msg = (transferErr as Error).message;

      // Compensation A2 — Stripe Connect Express n'émet pas l'event webhook
      // transfer.failed (transfers synchrones API). Le throw ici est le seul
      // signal d'échec → on doit poser le row 'failed' + audit + alerte admin
      // synchrone (pas de retry auto, désaligne le path resume vers manual
      // review). Bundle 3 TB a gardé l'enum stripe_transfer_failed +
      // template admin_transfer_failed pour ce consumer (cf commentaire
      // log-payment-event.ts:66-76).
      console.warn(
        `[STRIPE_TRANSFER_FAILED_SYNC] payout=${newRow.id} producer=${producerId} reason=${msg}`,
      );

      // 1. UPDATE 'failed' + error_msg (vs 'processing' qui aurait déclenché
      //    retry). Cas pathologique : si UPDATE échoue, row reste 'processing'
      //    et le prochain run tentera le resume — l'idempotencyKey Stripe
      //    renverra le même throw 24h, on retombera dans ce catch. Acceptable.
      //    error_msg dénormalise le message d'erreur dans la column dédiée
      //    (T-426) — alignement avec audit_logs.metadata.error_message
      //    historique mais query plus rapide pour debug back-office.
      const { error: failedUpdateErr } = await admin
        .from("payouts")
        .update({ statut: "failed", error_msg: msg })
        .eq("id", newRow.id);
      if (failedUpdateErr) {
        console.warn(
          `[WEEKLY_PAYOUT_FAILED_UPDATE_FAILED] payout=${newRow.id} reason=${failedUpdateErr.message}`,
        );
      }

      // 2. Lookup nom_exploitation pour subject email (best-effort).
      const { data: producerNom } = await admin
        .from("producers")
        .select("nom_exploitation")
        .eq("id", producerId)
        .maybeSingle();
      const exploitation =
        (producerNom as { nom_exploitation?: string | null } | null)
          ?.nom_exploitation ?? null;

      // 3. Audit log forensique (logPaymentEvent est lui-même fail-safe).
      await logPaymentEvent({
        eventType: "stripe_transfer_failed",
        metadata: {
          payout_id: newRow.id,
          producer_id: producerId,
          periode_debut: periodeDebut,
          periode_fin: periodeFin,
          montant_net_cents: montantNetCents,
          currency: "eur",
          error_message: msg,
          // Discrimine du futur webhook (n'arrive jamais sur Express, mais
          // flag prévoit cohérence forensique si Stripe change leur API).
          source: "sync_transfer_create",
        },
      });

      // 4. Notification placeholder DB — pattern aligné handle-payout-failed.tsx
      //    (insert "intent" synchrone, l'envoi Resend insérera son propre row).
      await admin.from("notifications").insert({
        user_id: null,
        type: "email",
        template: "admin_transfer_failed",
        statut: "sent",
        metadata: {
          payout_id: newRow.id,
          producer_id: producerId,
          periode_debut: periodeDebut,
          montant_net_cents: montantNetCents,
          error_message: msg,
        },
      });

      // 5. Email réel admin via Resend (fire-and-forget waitUntil).
      const dashboardUrl = `https://dashboard.stripe.com/connect/accounts/${producer.stripe_account_id}/transfers`;
      const props = {
        exploitation,
        amount: montantNet,
        currency: "eur",
        // transferId: pas d'ID Stripe (le throw a précédé la création).
        // Placeholder informatif pour le template qui exige string.
        transferId: `(échec synchrone — payout ${newRow.id})`,
        failureMessage: msg,
        failureCode: null,
        dashboardUrl,
      };
      waitUntil(
        sendTemplate({
          to: SUPPORT_EMAIL,
          userId: null,
          template: "admin_transfer_failed",
          subject: adminTransferFailedSubject(props),
          element: <AdminTransferFailed {...props} />,
          metadata: {
            payout_id: newRow.id,
            producer_id: producerId,
          },
        }).catch((err) => {
          console.error(
            `[STRIPE_TRANSFER_FAILED_EMAIL_ERR] payout=${newRow.id} error=${(err as Error).message}`,
          );
        }),
      );

      results.push({
        ...baseResult,
        payout_id: newRow.id,
        stripe_transfer_id: null,
        error: `Transfer failed: ${msg}`,
      });
      continue;
    }

    const { error: updateErr } = await admin
      .from("payouts")
      .update({ statut: "paid", stripe_transfer_id: transferId })
      .eq("id", newRow.id);

    if (updateErr) {
      // Row reste 'processing' → prochain run reprend par chemin resume,
      // l'idempotencyKey Stripe récupère le Transfer existant (cas (c)).
      console.warn(
        `[WEEKLY_PAYOUT_UPDATE_FAILED] payout=${newRow.id} transfer=${transferId} reason=${updateErr.message}`,
      );
      results.push({
        ...baseResult,
        payout_id: newRow.id,
        stripe_transfer_id: transferId,
        error: `UPDATE failed (will resume): ${updateErr.message}`,
      });
      continue;
    }

    // T-416 audit log forensique post-UPDATE 'paid' succès path nominal.
    // Montants depuis recomputation locale = ceux qui viennent d'être
    // INSERTed (source of truth puisque l'INSERT vient juste d'avoir lieu
    // avec ces valeurs, l. ~278-289).
    await logPaymentEvent({
      eventType: "stripe_transfer_initiated",
      userId: null,
      metadata: {
        payout_id: newRow.id,
        stripe_transfer_id: transferId,
        producer_id: producerId,
        periode_debut: periodeDebut,
        periode_fin: periodeFin,
        montant_brut_cents: montantBrutCents,
        commission_cents: commissionCents,
        montant_net_cents: montantNetCents,
        currency: "eur",
        orders_count: producerOrders.length,
        resumed: false,
      },
    });

    results.push({
      ...baseResult,
      payout_id: newRow.id,
      stripe_transfer_id: transferId,
    });
  }

  return { start, end, results };
}
