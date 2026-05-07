import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logReviewEvent } from "@/lib/audit-logs/log-review-event";

// Admin override : suppression d'une réponse Producer abusive (modération
// a posteriori, override de la lock 24h producer). Décision business :
// l'admin peut supprimer à tout moment, indépendamment de la fenêtre 24h.
//
// Snapshot du texte supprimé conservé en metadata audit_logs pour
// traçabilité forensique légale (litige producer si suppression contestée).

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: review } = await admin
    .from("reviews")
    .select("id, producer_id, producer_response")
    .eq("id", params.id)
    .maybeSingle();

  if (!review) {
    return NextResponse.json({ error: "Avis introuvable" }, { status: 404 });
  }

  if (review.producer_response === null) {
    return NextResponse.json(
      { error: "Pas de réponse à supprimer" },
      { status: 409 },
    );
  }

  // Snapshot avant suppression pour audit forensique.
  const snapshotLength = review.producer_response.length;

  const { error: updateError } = await admin
    .from("reviews")
    .update({
      producer_response: null,
      producer_response_status: "removed_admin",
    })
    .eq("id", review.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logReviewEvent({
    eventType: "producer_response_removed_by_admin",
    userId: session.id,
    metadata: {
      review_id: review.id,
      producer_id: review.producer_id,
      response_length: snapshotLength,
    },
  });

  return NextResponse.json({ ok: true });
}
