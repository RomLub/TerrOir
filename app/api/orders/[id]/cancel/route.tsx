import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { userOwnsProducer } from "@/lib/auth/producerOwnership";
import { revalidatePublicStats } from "@/lib/stats/revalidate";
import { sqlstateToStatus } from "@/lib/api/sqlstate-to-status";
import {
  InvalidOrderTransitionError,
  assertTransition,
  canConsumerCancel,
  isTerminal,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import {
  BADGE_WINDOW_MONTHS,
  BLAMING_CLOSURE_REASONS,
} from "@/lib/producers/scoring-constants";
import { stripe } from "@/lib/stripe/server";
import { sendTemplate } from "@/lib/resend/send";
import { classifyRefundError } from "@/lib/refund-incidents/classify-error";
import { recordRefundAttempt } from "@/lib/refund-incidents/record-refund-attempt";
import { sendOpsAlert } from "@/lib/ops/alert";
import { reverseTransferIfNeeded } from "@/lib/stripe/reverse-transfer";
import OrderTimeoutCancelled, {
  subject as timeoutSubject,
} from "@/lib/resend/templates/order-timeout-cancelled";

const bodySchema = z.object({
  reason: z
    .enum(["stock", "producer_cancel", "consumer_cancel", "timeout", "other"])
    .optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, props0: RouteContext) {
  const params = await props0.params;
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  let reason = parsed.data.reason ?? "other";

  const admin = createSupabaseAdminClient();

  const { data: order, error: orderLookupErr } = await admin
    .from("orders")
    .select(
      "id, producer_id, consumer_id, statut, stripe_payment_intent_id, montant_total, code_commande, created_at",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (orderLookupErr) {
    console.error(
      `[ORDER_LOOKUP_ERR] route=cancel order_id=${params.id} error=${orderLookupErr.message}`,
    );
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (isTerminal(order.statut as OrderStatus)) {
    return NextResponse.json({ ok: true, already: true });
  }

  // Auth: admin, producteur propriétaire, ou consumer pour sa propre
  // commande tant qu'elle est encore pending.
  let authorizedByProducer = false;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isAdmin) {
    // OK
  } else if (session.roles.includes("producer")) {
    if (!(await userOwnsProducer(admin, session.id, order.producer_id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    authorizedByProducer = true;
  } else if (
    session.id === order.consumer_id &&
    canConsumerCancel(order.statut as OrderStatus)
  ) {
    // Fenêtre stricte : tant que le producteur n'a pas confirmé, zéro
    // engagement de sa part → l'annulation consumer est sans préjudice.
    // Après 'confirmed' le consumer doit passer par contact direct.
    // canConsumerCancel = source de vérité partagée (lib/orders/stateMachine.ts).
    // reason forcée à "consumer_cancel" pour analytics propres + défense
    // contre un client forgeant une reason réservée producteur ("stock").
    // authorizedByProducer reste false → pas de recalcul du badge.
    reason = "consumer_cancel";
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // T-410 : valider la transition d'etat AVANT d'emettre un refund Stripe
  // irrécupérable. La cible *tentative* dépend de la presence d'un PI
  // (refunded si paid, sinon cancelled). Vu la matrice TRANSITIONS, depuis
  // pending/confirmed (les seuls atteignant ce point post-isTerminal) les
  // deux cibles sont équivalemment légales → valider la tentative suffit.
  // Pattern aligné refund/route.ts:78-85.
  const from = order.statut as OrderStatus;
  const tentativeFinalStatus: OrderStatus = order.stripe_payment_intent_id
    ? "refunded"
    : "cancelled";
  try {
    assertTransition(from, tentativeFinalStatus);
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  // 1. Remboursement Stripe si déjà payé
  // T-408 idempotencyKey : `refund_${order.id}_manual_cancel` (UUID stable +
  // context discriminator). Distinct de `refund_${order_id}_${attempt}`
  // (cron retry-failed-refunds, retry-failed-refund.ts:80) et des autres
  // contexts (admin, timeout) — pas de collision keys.
  //
  // F-004 — Reversal AVANT refund (Option A, atomicité d'échec).
  // Comportement kind='failed' sur ce path manual-cancel automatique :
  //   - On CONTINUE le refund quand même (pas de bloquer 502).
  // Rationnel : cancel manuel est un path utilisateur direct (admin/producer/
  // consumer en self-cancel). Bloquer laisserait l'order stuck en pending
  // sans recours UX. On absorbe la perte platform (rare : transfer_id requiert
  // statut='completed' qui n'est PAS atteignable depuis ce path car cancel
  // bloque sur isTerminal). En pratique le helper noop_no_transfer_id sur
  // 99%+ des appels — la branche failed reste un filet défensif.
  // Refacto futur : si tu uniformises ce comportement, vérifie l'invariant
  // par caller dans le commit de référence F-004 sub-2.
  let refundError: string | undefined;
  let refundEmitted = false;
  if (order.stripe_payment_intent_id) {
    await reverseTransferIfNeeded({
      admin,
      orderId: order.id,
      amountEur: Number(order.montant_total),
      source: "refund_cancel",
    });
    try {
      // F-063 (audit pré-launch 2026-05-11) — `reason` + `closure_reason`
      // pour reporting Stripe Dashboard + grep audit ops.
      await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id,
          reason: "requested_by_customer",
          metadata: { closure_reason: "manual_cancel", order_id: order.id },
        },
        { idempotencyKey: `refund_${order.id}_manual_cancel` },
      );
      refundEmitted = true;
    } catch (e) {
      refundError = (e as Error).message;
      // Cluster B Phase 3 (bugs-P1-4) — pattern T-102.2.b complet : double
      // ecriture refund_incidents + audit_logs sur refund failed pour que
      // le cron `retry-failed-refunds` puisse reprendre l'orphelin. Helper
      // fail-safe (ne throw pas).
      const classified = classifyRefundError(e);
      await recordRefundAttempt({
        orderId: order.id,
        kind: "manual_cancel",
        paymentIntentId: order.stripe_payment_intent_id,
        consumerId: order.consumer_id,
        blockedReason: null,
        outcome: "failed",
        classified,
      });
    }
  }

  // Statut cible final : refunded si le refund Stripe a reussi, sinon
  // fallback cancelled. Post-T-151 toutes les transitions sont LEGAL ; le
  // filet POST-refund couvre une régression future de la matrice ou
  // un drift où la cible bascule de refunded → cancelled.
  const finalStatus: OrderStatus =
    order.stripe_payment_intent_id && !refundError ? "refunded" : "cancelled";

  if (finalStatus !== tentativeFinalStatus) {
    try {
      assertTransition(from, finalStatus);
    } catch (e) {
      if (e instanceof InvalidOrderTransitionError) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      throw e;
    }
  }

  // F-001 P0-TA : transition pending|confirmed → cancelled|refunded via RPC
  // SECDEF cancel_order (auth dispatch interne admin > producer > consumer
  // + assertTransition SQL-side + UPDATE atomique race-safe + audit log
  // `order_cancelled` posé sauf si reason ∈ {admin_refund, timeout,
  // efw_preemptive} — caller ici écrit pas d'audit Stripe-aware côté manual
  // cancel, donc audit RPC posé pour reason=stock|producer_cancel|
  // consumer_cancel|other|payment_failed). Cluster B Phase 3 (bugs-P1-1)
  // guard [REFUND_DB_DRIFT] préservé sur erreur RPC post-refund Stripe émis.
  const { error: rpcError } = await admin.rpc("cancel_order", {
    p_order_id: order.id,
    p_reason: reason,
    p_target_status: finalStatus,
  });

  if (rpcError) {
    const status = sqlstateToStatus(rpcError.code);
    if (refundEmitted) {
      console.warn(
        `[REFUND_DB_DRIFT] order=${order.id} pi=${order.stripe_payment_intent_id} ${rpcError.message}`,
      );
      await sendOpsAlert("[REFUND_DB_DRIFT]", new Error(rpcError.message), {
        order_id: order.id,
        path: "manual_cancel",
        final_status: finalStatus,
        db_error: rpcError.message,
        rpc_code: rpcError.code ?? "none",
      });
    }
    if (status === 500) {
      console.error(
        `[CANCEL_RPC_ERR] order=${order.id} code=${rpcError.code ?? "none"} message=${rpcError.message}`,
      );
      return NextResponse.json(
        {
          error: "Internal database error",
          warning: refundEmitted
            ? `[REFUND_DB_DRIFT] order=${order.id} ${rpcError.message}`
            : undefined,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      {
        error: rpcError.message,
        code: rpcError.code ?? undefined,
        warning: refundEmitted
          ? `[REFUND_DB_DRIFT] order=${order.id} ${rpcError.message}`
          : undefined,
      },
      { status },
    );
  }

  // Invalide le cache des stats publiques (ordersCount sur la home) :
  // si l'order quittait le filtre IN ('confirmed','completed'), le
  // count change. Inconditionnel pour simplifier — pending → cancelled n'a
  // pas d'impact mais coût d'invalidation négligeable. Le helper swallow
  // toute exception (cache flapping ne doit pas faire échouer le 200).
  await revalidatePublicStats({ source: "order-cancel", orderId: order.id });

  // 2. Badge anti-annulation : recompute SI l'annulation est imputable au
  // producteur (reason ∈ BLAMING_CLOSURE_REASONS). Sinon (consumer_cancel,
  // timeout, payment_failed, other), le ratio des annulations imputables
  // n'a pas bougé — skip économise un round-trip DB sans perte de précision.
  const isBlamingCancel =
    authorizedByProducer &&
    (BLAMING_CLOSURE_REASONS as readonly string[]).includes(reason);
  if (isBlamingCancel) {
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - BADGE_WINDOW_MONTHS);
    const { data: history } = await admin
      .from("orders")
      .select("statut, closure_reason")
      .eq("producer_id", order.producer_id)
      .gte("created_at", cutoff.toISOString());
    if (history && history.length > 0) {
      // Filtre cohérent avec recompute-badges : on ne compte une order
      // comme "annulation imputable" que si elle est cancelled/refunded
      // ET son closure_reason est dans BLAMING_CLOSURE_REASONS.
      const cancelledBlaming = history.filter(
        (o) =>
          (o.statut === "cancelled" || o.statut === "refunded") &&
          (BLAMING_CLOSURE_REASONS as readonly string[]).includes(
            o.closure_reason ?? "",
          ),
      ).length;
      const score =
        Math.round(((history.length - cancelledBlaming) / history.length) * 10000) /
        100;
      await admin
        .from("producers")
        .update({ badge_annulation_score: score })
        .eq("id", order.producer_id);
    }
  }

  // 3. Alerte admin si 2e rupture de stock du mois
  if (reason === "stock") {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("producer_id", order.producer_id)
      .eq("closure_reason", "stock")
      .gte("cancelled_at", monthStart.toISOString());

    if ((count ?? 0) >= 2) {
      const { data: admins } = await admin
        .from("admin_users")
        .select("id");
      if (admins) {
        await admin.from("notifications").insert(
          admins.map((a) => ({
            user_id: a.id,
            type: "email",
            template: "admin_stock_repeat_offender",
            statut: "sent",
            metadata: {
              producer_id: order.producer_id,
              stock_cancellations_this_month: count,
              order_id: order.id,
            },
          })),
        );
      }
    }
  }

  // 4. Email "annulée" au consommateur (template timeout sert de générique
  //    annulation + remboursement)
  const { data: consumer } = await admin
    .from("users")
    .select("email")
    .eq("id", order.consumer_id)
    .maybeSingle();
  const { data: producer } = await admin
    .from("producers")
    .select("nom_exploitation")
    .eq("id", order.producer_id)
    .maybeSingle();

  if (consumer?.email && producer) {
    const props = {
      codeCommande: order.code_commande,
      exploitation: producer.nom_exploitation,
      amount: Number(order.montant_total),
    };
    await sendTemplate({
      to: consumer.email,
      userId: order.consumer_id,
      template: "order_cancelled",
      subject: timeoutSubject(props),
      element: <OrderTimeoutCancelled {...props} />,
      metadata: {
        order_id: order.id,
        code_commande: order.code_commande,
        reason,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    statut: finalStatus,
    refund_error: refundError,
  });
}
