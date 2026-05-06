import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { userOwnsProducer } from "@/lib/auth/producerOwnership";
import {
  InvalidOrderTransitionError,
  assertTransition,
  type OrderStatus,
} from "@/lib/orders/stateMachine";
import { sendPickupReviewEmail } from "@/lib/orders/send-pickup-review-email";

const bodySchema = z.object({
  code_commande: z.string().trim().min(1),
});

interface RouteContext {
  params: { id: string };
}

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
  if (!(await userOwnsProducer(admin, session.id, order.producer_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.statut === "completed") {
    return NextResponse.json({ ok: true, already: true });
  }
  try {
    assertTransition(order.statut as OrderStatus, "completed");
  } catch (e) {
    if (e instanceof InvalidOrderTransitionError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
  if (
    parsed.data.code_commande.trim().toUpperCase() !==
    order.code_commande.toUpperCase()
  ) {
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

  // L'inclusion dans le prochain payout est automatique : /api/cron/weekly-payout
  // filtre sur statut='completed' + completed_at dans la plage du lundi précédent.
  return NextResponse.json({
    ok: true,
    completed_at: completedAt.toISOString(),
  });
}
