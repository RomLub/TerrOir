import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  order_id: z.string().guid(),
  note: z.number().int().min(1).max(5),
  commentaire: z.string().trim().max(2000).optional(),
});

// Audit RPC M-2 : refacto user-client + RLS-driven (audit-rpc-edge-2026-05-05).
// Avant : admin client + check applicatif `order.consumer_id !== session.id`
// (fragile, contournement RLS direct si check buggé). Après : SELECT initial
// via user client → RLS "orders parties read" filtre naturellement. INSERT
// review via user client → RLS "reviews consumer insert after completed order"
// valide consumer_id + statut completed. Admin client conservé uniquement
// pour le bloc notifications admins (RLS n'autorise qu'INSERT service-role).
//
// Pattern aligné avec /api/orders/create (user client SELECT, write côté RLS).

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

  const supabase = await createSupabaseServerClient();

  // RLS "orders parties read" : auth.uid() == consumer_id OR owns_producer.
  // Si l'user n'est pas concerné → 0 row → 404 (équivalent fonctionnel d'un
  // 403, mais on ne révèle pas l'existence d'une order qui n'appartient pas
  // à l'user).
  const { data: order } = await supabase
    .from("orders")
    .select("id, producer_id, consumer_id, statut")
    .eq("id", parsed.data.order_id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Le filtre RLS autorise aussi le producer-owner à lire l'order. On
  // restreint la création de review au consumer (cohérent avec la RLS
  // "reviews consumer insert after completed order" qui exige
  // auth.uid() == consumer_id en with_check).
  if (order.consumer_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (order.statut !== "completed") {
    return NextResponse.json(
      { error: "La commande doit être terminée pour noter" },
      { status: 409 },
    );
  }

  // RLS "reviews author read" filtre sur consumer_id = auth.uid() — donc
  // user client voit uniquement ses propres reviews. Si une review existe
  // déjà pour cet order, c'est forcément la sienne.
  const { data: existing } = await supabase
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

  // INSERT user client : la RLS "reviews consumer insert after completed
  // order" valide auth.uid() == consumer_id ET is_completed_order_of_caller
  // (defense-in-depth si le check applicatif ci-dessus était contourné).
  const { data: review, error: insertError } = await supabase
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

  // Notifications admins : admin client requis (RLS notifications n'autorise
  // que self-read, pas d'INSERT pour authenticated).
  const admin = createSupabaseAdminClient();
  const { data: admins } = await admin.from("admin_users").select("id");
  if (admins && admins.length > 0) {
    const { error: notifErr } = await admin.from("notifications").insert(
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
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=admin_review_pending count=${admins.length} error=${notifErr.message}`,
      );
    }
  }

  return NextResponse.json({ review_id: review.id, statut: "pending" });
}
