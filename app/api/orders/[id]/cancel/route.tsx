import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { userOwnsProducer } from "@/lib/auth/producerOwnership";
import {
  InvalidOrderTransitionError,
  assertTransition,
  isTerminal,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import { stripe } from "@/lib/stripe/server";
import { sendTemplate } from "@/lib/resend/send";
import OrderTimeoutCancelled, {
  subject as timeoutSubject,
} from "@/lib/resend/templates/order-timeout-cancelled";

const bodySchema = z.object({
  reason: z
    .enum(["stock", "producer_cancel", "consumer_cancel", "timeout", "other"])
    .optional(),
});

interface RouteContext {
  params: { id: string };
}

export async function POST(request: Request, { params }: RouteContext) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  let reason = parsed.data.reason ?? "other";

  const admin = createSupabaseAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, producer_id, consumer_id, statut, stripe_payment_intent_id, montant_total, code_commande, created_at",
    )
    .eq("id", params.id)
    .maybeSingle();
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
    order.statut === "pending"
  ) {
    // Fenêtre stricte : tant que le producteur n'a pas confirmé, zéro
    // engagement de sa part → l'annulation consumer est sans préjudice.
    // Après 'confirmed' le consumer doit passer par contact direct.
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
  // pending/confirmed/ready (les seuls atteignant ce point post-isTerminal)
  // les deux cibles sont équivalemment légales → valider la tentative
  // suffit. Pattern aligné refund/route.ts:78-85.
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
  let refundError: string | undefined;
  if (order.stripe_payment_intent_id) {
    try {
      await stripe.refunds.create(
        { payment_intent: order.stripe_payment_intent_id },
        { idempotencyKey: `refund_${order.id}_manual_cancel` },
      );
    } catch (e) {
      refundError = (e as Error).message;
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

  await admin
    .from("orders")
    .update({
      statut: finalStatus,
      closure_reason: reason,
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  // Invalide le cache des stats publiques (ordersCount sur la home) :
  // si l'order quittait le filtre IN ('confirmed','ready','completed'), le
  // count change. Inconditionnel pour simplifier — pending → cancelled n'a
  // pas d'impact mais coût d'invalidation négligeable.
  try {
    revalidateTag("public-stats");
  } catch (e) {
    console.warn(`[STATS_REVAL_WARN] order=${order.id} ${(e as Error).message}`);
  }

  // 2. Badge anti-annulation si l'annulation vient du producteur
  if (authorizedByProducer) {
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
    const { data: history } = await admin
      .from("orders")
      .select("id, statut")
      .eq("producer_id", order.producer_id)
      .gte("created_at", cutoff.toISOString());
    if (history && history.length > 0) {
      const nonCancelled = history.filter(
        (o) => o.statut !== "cancelled" && o.statut !== "refunded",
      ).length;
      const score = Math.round((nonCancelled / history.length) * 10000) / 100;
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
