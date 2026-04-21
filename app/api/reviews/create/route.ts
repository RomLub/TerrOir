import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  order_id: z.string().uuid(),
  note: z.number().int().min(1).max(5),
  commentaire: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request) {
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
    .select("id, consumer_id, producer_id, statut")
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.consumer_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.statut !== "completed") {
    return NextResponse.json(
      { error: "La commande doit être terminée pour noter" },
      { status: 409 },
    );
  }

  const { data: existing } = await admin
    .from("reviews")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "Un avis existe déjà pour cette commande" },
      { status: 409 },
    );
  }

  const { data: review, error: insertError } = await admin
    .from("reviews")
    .insert({
      order_id: order.id,
      consumer_id: order.consumer_id,
      producer_id: order.producer_id,
      note: parsed.data.note,
      commentaire: parsed.data.commentaire ?? null,
      statut: "pending",
    })
    .select("id")
    .single();

  if (insertError || !review) {
    return NextResponse.json(
      { error: insertError?.message ?? "Insertion impossible" },
      { status: 500 },
    );
  }

  // Notifier tous les admins pour modération
  const { data: admins } = await admin
    .from("admin_users")
    .select("id");
  if (admins && admins.length > 0) {
    await admin.from("notifications").insert(
      admins.map((a) => ({
        user_id: a.id,
        type: "email",
        template: "admin_review_pending",
        statut: "sent",
        metadata: {
          review_id: review.id,
          order_id: order.id,
          producer_id: order.producer_id,
          note: parsed.data.note,
        },
      })),
    );
  }

  return NextResponse.json({ review_id: review.id, statut: "pending" });
}
