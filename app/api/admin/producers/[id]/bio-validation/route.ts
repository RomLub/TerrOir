import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logProducersAdminEvent } from "@/lib/audit-logs/log-producers-admin-event";
import {
  revalidateProducerCard,
  revalidateProducersSearch,
} from "@/lib/stats/revalidate";

// PATCH /api/admin/producers/[id]/bio-validation — validation/refus admin de la
// certification bio d'un producteur (chantier 3 Phase 5).
//
// { validate: true }  → pose bio_validated_at = now() (le badge bio devient
//                       public, gating producers_public/search satisfait).
// { validate: false } → remet bio_validated_at = null (refus / révocation).
//
// service_role : le trigger producers_block_owner_admin_columns bloque
// bio_validated_at pour tout sauf service_role / is_admin. On revalide les
// caches publics (carte fiche + recherche) car bio entre dans l'exposition.

const bodySchema = z.object({ validate: z.boolean() });

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, props: RouteContext) {
  const { id } = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: before } = await admin
    .from("producers")
    .select("id, slug, nom_exploitation, bio, bio_certificate_number")
    .eq("id", id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // On ne valide un bio que si le producteur l'a déclaré.
  if (parsed.data.validate && !before.bio) {
    return NextResponse.json(
      { error: "Le producteur n'a pas déclaré de certification bio." },
      { status: 422 },
    );
  }

  const validatedAt = parsed.data.validate ? new Date().toISOString() : null;
  const { error } = await admin
    .from("producers")
    .update({ bio_validated_at: validatedAt })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }

  await logProducersAdminEvent({
    eventType: "admin_producer_bio_validated",
    userId: session.id,
    metadata: {
      producer_id: id,
      producer_name: before.nom_exploitation,
      validated: parsed.data.validate,
      certificate_number: before.bio_certificate_number ?? null,
    },
  });

  // bio entre dans l'exposition publique → on rafraîchit fiche + recherche.
  if (before.slug) {
    await revalidateProducerCard({ slug: before.slug, source: "admin-bio-validation" });
  }
  await revalidateProducersSearch({ source: "admin-bio-validation", producerId: id });

  return NextResponse.json({ id, bio_validated_at: validatedAt });
}
