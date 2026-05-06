import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedProducerId } from "@/lib/auth/producerOwnership";
import {
  InvalidOrderTransitionError,
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import { sendPickupReviewEmail } from "@/lib/orders/send-pickup-review-email";
import { logPickupEvent } from "@/lib/audit-logs/log-pickup-event";
import {
  consumeRateLimit,
  getPickupValidationRateLimit,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  code_commande: z.string().trim().min(1),
});

interface RouteContext {
  params: { id: string };
}

// LOT 5 chantier pickup-validation 2026-05-06 — rétrofit cluster pickup_*
// + rate-limit Upstash 10/min/producer cohérents avec la route code-based
// /api/producer/orders/validate-pickup. Pas de modif UX (cf. arbitrage Q3
// du brief : 1-clic conservé sur la page detail producer puisque la fiche
// joue le rôle de preview visuel — contexte commande déjà à l'écran).
const ROUTE_TAG = "complete_id_based";

export async function POST(request: Request, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Lookup producer du user AVANT le rate-limit pour pouvoir keying par
  // producerId (cohérent avec /api/producer/orders/validate-pickup) et
  // attacher l'audit log au bon scope.
  const producerId = await getOwnedProducerId(admin, session.id);
  if (!producerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate-limit Upstash 10/min/producer — partagé avec la route code-based
  // (single source de protection contre l'énumération de codes ou les
  // double-clics réseau flaky).
  const rateLimit = await consumeRateLimit(
    getPickupValidationRateLimit(),
    `producer:${producerId}`,
  );
  if (!rateLimit.success) {
    await logPickupEvent({
      eventType: "pickup_attempt_rate_limited",
      userId: session.id,
      metadata: { producer_id: producerId, route: ROUTE_TAG, method: "POST" },
    });
    const retrySec = Math.max(
      1,
      Math.ceil((rateLimit.reset - Date.now()) / 1000),
    );
    return NextResponse.json(
      { error: "rate_limit", retry_after_seconds: retrySec },
      { status: 429, headers: { "Retry-After": String(retrySec) } },
    );
  }

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, producer_id, consumer_id, statut, code_commande",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.producer_id !== producerId) {
    await logPickupEvent({
      eventType: "pickup_attempt_invalid",
      userId: session.id,
      metadata: {
        producer_id: producerId,
        order_id: order.id,
        reason: "wrong_producer",
        route: ROUTE_TAG,
      },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.statut === "completed") {
    await logPickupEvent({
      eventType: "pickup_attempt_invalid",
      userId: session.id,
      metadata: {
        producer_id: producerId,
        order_id: order.id,
        reason: "already_completed",
        route: ROUTE_TAG,
      },
    });
    return NextResponse.json({ ok: true, already: true });
  }
  try {
    assertTransition(order.statut as OrderStatus, "completed");
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      await logPickupEvent({
        eventType: "pickup_attempt_invalid",
        userId: session.id,
        metadata: {
          producer_id: producerId,
          order_id: order.id,
          reason: `order_not_confirmed:${order.statut}`,
          route: ROUTE_TAG,
        },
      });
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
  if (
    parsed.data.code_commande.trim().toUpperCase() !==
    order.code_commande.toUpperCase()
  ) {
    await logPickupEvent({
      eventType: "pickup_attempt_invalid",
      userId: session.id,
      metadata: {
        producer_id: producerId,
        order_id: order.id,
        reason: "code_mismatch",
        route: ROUTE_TAG,
      },
    });
    return NextResponse.json({ error: "Code invalide" }, { status: 400 });
  }

  const completedAt = new Date();
  const { error: updateError } = await admin
    .from("orders")
    .update({
      statut: "completed",
      completed_at: completedAt.toISOString(),
    })
    .eq("id", order.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Email review-request (J0). Les relances J+2 / J+7 sont gérées par le cron
  // /api/cron/review-followup. Helper partagé avec
  // /api/producer/orders/validate-pickup (LOT 3 chantier pickup-validation).
  await sendPickupReviewEmail(admin, {
    orderId: order.id,
    consumerId: order.consumer_id,
    producerId: order.producer_id,
    codeCommande: order.code_commande,
  });

  await logPickupEvent({
    eventType: "pickup_validated",
    userId: session.id,
    metadata: {
      producer_id: producerId,
      order_id: order.id,
      completed_at: completedAt.toISOString(),
      route: ROUTE_TAG,
    },
  });

  // L'inclusion dans le prochain payout est automatique : /api/cron/weekly-payout
  // filtre sur statut='completed' + completed_at dans la plage du lundi précédent.
  return NextResponse.json({
    ok: true,
    completed_at: completedAt.toISOString(),
  });
}
