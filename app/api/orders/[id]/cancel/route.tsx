import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { userOwnsProducer } from "@/lib/auth/producerOwnership";
import {
  InvalidOrderTransitionError,
  assertTransition,
  canTransition,
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
  const reason = parsed.data.reason ?? "other";

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

  // Auth: système (cron secret), admin, ou producteur propriétaire
  const cronSecret = process.env.CRON_SECRET;
  const isSystemCall =
    cronSecret !== undefined &&
    request.headers.get("x-cron-secret") === cronSecret;

  let authorizedByProducer = false;
  if (!isSystemCall) {
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
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // 1. Remboursement Stripe si déjà payé
  let refundError: string | undefined;
  if (order.stripe_payment_intent_id) {
    try {
      await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
      });
    } catch (e) {
      refundError = (e as Error).message;
    }
  }

  // Statut cible dynamique : refunded si le remboursement Stripe a réussi,
  // sinon cancelled. La state machine peut refuser refunded depuis certains
  // états (ex. ready) — on retombe alors sur cancelled, le refund côté Stripe
  // reste valide et est tracé dans les logs Stripe.
  const from = order.statut as OrderStatus;
  let finalStatus: OrderStatus =
    order.stripe_payment_intent_id && !refundError ? "refunded" : "cancelled";
  if (!canTransition(from, finalStatus)) {
    finalStatus = "cancelled";
  }

  try {
    assertTransition(from, finalStatus);
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }

  await admin
    .from("orders")
    .update({
      statut: finalStatus,
      cancellation_reason: reason,
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
      .eq("cancellation_reason", "stock")
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
