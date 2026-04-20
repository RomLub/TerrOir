import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  action: z.enum(["publish", "reject"]),
});

interface RouteContext {
  params: { id: string };
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Action requise (publish | reject)" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: review } = await admin
    .from("reviews")
    .select("id, producer_id, statut")
    .eq("id", params.id)
    .maybeSingle();
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  const isPublish = parsed.data.action === "publish";
  const update: Record<string, unknown> = {
    statut: isPublish ? "published" : "rejected",
  };
  if (isPublish) update.published_at = new Date().toISOString();

  const { error: updateError } = await admin
    .from("reviews")
    .update(update)
    .eq("id", review.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Recalcul complet du cache (publish ET reject) : un rejet peut concerner
  // une review déjà published qui doit disparaître de la moyenne.
  const { data: stats } = await admin
    .from("reviews")
    .select("note")
    .eq("producer_id", review.producer_id)
    .eq("statut", "published");

  let noteMoyenne = 0;
  let nbAvis = 0;
  if (stats && stats.length > 0) {
    nbAvis = stats.length;
    const total = stats.reduce((s, r) => s + Number(r.note), 0);
    noteMoyenne = Math.round((total / stats.length) * 100) / 100;
  }

  const { error: producerUpdateError } = await admin
    .from("producers")
    .update({ note_moyenne: noteMoyenne, nb_avis: nbAvis })
    .eq("id", review.producer_id);
  if (producerUpdateError) {
    return NextResponse.json(
      {
        review_id: review.id,
        statut: update.statut,
        warning: `Cache producteur non mis à jour : ${producerUpdateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    review_id: review.id,
    statut: update.statut,
    producer_stats: { note_moyenne: noteMoyenne, nb_avis: nbAvis },
  });
}
