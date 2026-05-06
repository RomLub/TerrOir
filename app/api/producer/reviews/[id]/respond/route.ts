import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logReviewEvent } from "@/lib/audit-logs/log-review-event";
import { sendReviewResponseEmail } from "@/lib/notifications/send-review-response-email";

// Droit de réponse Producer aux avis (CGU 6.4) — publication immédiate,
// éditable + supprimable pendant 24h, puis figée.
//
// Architecture :
//   - POST = create OU update dans la fenêtre 24h (idempotent côté client UI).
//   - DELETE = remove dans la fenêtre 24h (status=removed_producer).
//   - Lock 24h vérifié côté API via producer_response_locked_at vs NOW().
//   - RLS "reviews producer response update" autorise l'UPDATE pour le
//     producer owner (defense-in-depth).
//   - Vérification ownership via la query SELECT initiale (si la review
//     n'appartient pas au producer du caller, owns_producer renverra false
//     → 0 row → 404).
//   - Email consumer (waitUntil) sur create initial ; pas sur update/delete
//     (éviter spam, cohérent avec décisions business).

const bodySchema = z.object({
  response: z.string().trim().min(1, "Réponse vide").max(500, "Max 500 caractères"),
});

interface RouteContext {
  params: { id: string };
}

async function getProducerForUser(userId: string): Promise<string | null> {
  // Lookup producer.id via user_id. Admin client : la RLS producers self
  // l'autoriserait avec user client, mais on passe par admin pour rester
  // simple (read-only sur producers est OK).
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function POST(request: Request, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const producerId = await getProducerForUser(session.id);
  if (!producerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body invalide" },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();

  // RLS "reviews producer response update" + ownership : on filtre sur
  // producer_id pour récupérer uniquement la review du producer caller.
  // Si l'id de review n'appartient pas au producer → 0 row → 404.
  const { data: review } = await supabase
    .from("reviews")
    .select(
      "id, producer_id, consumer_id, statut, producer_response, producer_response_locked_at",
    )
    .eq("id", params.id)
    .eq("producer_id", producerId)
    .maybeSingle();

  if (!review) {
    return NextResponse.json({ error: "Avis introuvable" }, { status: 404 });
  }

  // La réponse n'a de sens que si l'avis est public (statut=published).
  // Sinon le producer répondrait à un avis encore en pending modération
  // ou rejeté, ce qui produirait une UX confuse côté admin/consumer.
  if (review.statut !== "published") {
    return NextResponse.json(
      { error: "Avis non publié, réponse impossible" },
      { status: 409 },
    );
  }

  const now = new Date();
  const isUpdate = review.producer_response !== null;

  if (isUpdate) {
    // Modification : vérifier la fenêtre 24h.
    const lockedAt = review.producer_response_locked_at
      ? new Date(review.producer_response_locked_at)
      : null;
    if (!lockedAt || lockedAt < now) {
      return NextResponse.json(
        { error: "Réponse figée, modification impossible après 24h" },
        { status: 403 },
      );
    }

    const { error: updateError } = await supabase
      .from("reviews")
      .update({
        producer_response: parsed.data.response,
        producer_response_updated_at: now.toISOString(),
        // producer_response_at NEVER updated en édition.
        // producer_response_locked_at NEVER updated (la fenêtre court
        // depuis la publication initiale, pas depuis l'édition).
        producer_response_status: "published",
      })
      .eq("id", review.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await logReviewEvent({
      eventType: "producer_response_updated",
      userId: session.id,
      metadata: {
        review_id: review.id,
        producer_id: producerId,
        response_length: parsed.data.response.length,
      },
    });

    return NextResponse.json({ ok: true, mode: "updated" });
  }

  // Nouvelle réponse : INSERT (UPDATE des colonnes producer_response_*).
  const lockedAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const { error: insertError } = await supabase
    .from("reviews")
    .update({
      producer_response: parsed.data.response,
      producer_response_at: now.toISOString(),
      producer_response_locked_at: lockedAt.toISOString(),
      producer_response_status: "published",
    })
    .eq("id", review.id);

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await logReviewEvent({
    eventType: "producer_response_published",
    userId: session.id,
    metadata: {
      review_id: review.id,
      producer_id: producerId,
      response_length: parsed.data.response.length,
    },
  });

  // Notification consumer (best-effort, fail-safe : log warn mais ne casse
  // pas la response API). On ne wrap pas dans waitUntil ici pour rester
  // explicite côté tests — l'envoi prend ~150ms (Resend + render), acceptable.
  try {
    await sendReviewResponseEmail({
      reviewId: review.id,
      consumerId: review.consumer_id,
      producerId,
      responseText: parsed.data.response,
    });
  } catch (err) {
    console.warn(
      `[REVIEW_RESPONSE_EMAIL_WARN] review_id=${review.id} error=${(err as Error).message}`,
    );
  }

  return NextResponse.json({ ok: true, mode: "created" });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const producerId = await getProducerForUser(session.id);
  if (!producerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createSupabaseServerClient();
  const { data: review } = await supabase
    .from("reviews")
    .select("id, producer_response, producer_response_locked_at")
    .eq("id", params.id)
    .eq("producer_id", producerId)
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

  const lockedAt = review.producer_response_locked_at
    ? new Date(review.producer_response_locked_at)
    : null;
  if (!lockedAt || lockedAt < new Date()) {
    return NextResponse.json(
      { error: "Réponse figée, suppression impossible après 24h" },
      { status: 403 },
    );
  }

  const { error: updateError } = await supabase
    .from("reviews")
    .update({
      producer_response: null,
      producer_response_status: "removed_producer",
      // On garde producer_response_at / locked_at pour traçabilité forensique.
    })
    .eq("id", review.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logReviewEvent({
    eventType: "producer_response_deleted_by_producer",
    userId: session.id,
    metadata: { review_id: review.id, producer_id: producerId },
  });

  return NextResponse.json({ ok: true });
}
