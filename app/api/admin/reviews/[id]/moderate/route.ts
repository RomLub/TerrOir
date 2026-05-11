import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  revalidateProducerCard,
  revalidateProducerReviews,
} from "@/lib/stats/revalidate";

const bodySchema = z.object({
  action: z.enum(["publish", "reject"]),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
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

  // bugs-P2-3 : embed producers.slug pour invalider le tag `producer:<slug>`
  // après update note_moyenne/nb_avis. Sans ça, la fiche /producteurs/[slug]
  // sert la note stale jusqu'à 60s (revalidate du unstable_cache du bloc
  // producer côté page.tsx).
  const { data: review } = await admin
    .from("reviews")
    .select("id, producer_id, statut, producers!inner(slug)")
    .eq("id", params.id)
    .maybeSingle();
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  const producerSlug = Array.isArray(review.producers)
    ? review.producers[0]?.slug
    : (review.producers as { slug: string } | null)?.slug;

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
    // bugs-P3-3 (T9 2026-05-07) : ne pas exposer updateError.message dans
    // la réponse — même auth-gated admin, c'est une bonne hygiène (l'admin
    // ne tire rien d'utile du message Postgres brut). Loggué côté serveur.
    console.error(
      `[ADMIN_REVIEW_MODERATE_UPDATE_ERR] review=${review.id} action=${parsed.data.action} error=${updateError.message}`,
    );
    return NextResponse.json(
      { error: "Internal database error" },
      { status: 500 },
    );
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
    // bugs-P3-3 (T9 2026-05-07) : retirer le message Postgres exposé. Le
    // détail va dans console.error pour la SRE, l'admin reçoit un warning
    // générique.
    console.error(
      `[ADMIN_REVIEW_MODERATE_PRODUCER_UPDATE_ERR] review=${review.id} producer=${review.producer_id} error=${producerUpdateError.message}`,
    );
    return NextResponse.json(
      {
        review_id: review.id,
        statut: update.statut,
        warning: "Cache producteur non mis à jour",
      },
      { status: 500 },
    );
  }

  // bugs-P2-3 : invalidation explicite du tag `producer:<slug>` après UPDATE
  // note_moyenne/nb_avis. Fail-safe (le helper swallow l'erreur). Sans cet
  // appel, la fiche /producteurs/[slug] sert la note stale jusqu'à 60s.
  if (producerSlug) {
    await revalidateProducerCard({
      slug: producerSlug,
      source: "admin-reviews-moderate",
    });
    // F-047 : invalide aussi le cache des reviews affichées sur la fiche
    // /producteurs/[slug]. Sans ça, publish/reject prend jusqu'à 30s à
    // se propager (revalidate TTL du unstable_cache page-level).
    await revalidateProducerReviews({
      slug: producerSlug,
      source: "admin-reviews-moderate",
    });
  }

  return NextResponse.json({
    review_id: review.id,
    statut: update.statut,
    producer_stats: { note_moyenne: noteMoyenne, nb_avis: nbAvis },
  });
}
