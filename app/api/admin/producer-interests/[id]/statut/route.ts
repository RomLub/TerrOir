import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import { updateProducerInterestStatut } from "@/lib/admin/producer-interests/mutations";
import { LEAD_STATUSES } from "@/lib/admin/producer-interests/types";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";

// Route admin /api/admin/producer-interests/[id]/statut — refactor PR1
// admin-pattern-uniform.
//
// PATCH : update du statut d'un lead producteur + audit log
//         admin_producer_interest_statut_changed (snapshot previous + new).
//
// Pré-SELECT obligatoire pour :
//   - répondre 404 si l'interest n'existe pas (sinon UPDATE eq id inexistant
//     renvoie 0 rows sans erreur, comportement silencieux),
//   - capturer previous_statut + email snapshot pour la metadata audit.

const bodySchema = z.object({
  statut: z.enum(LEAD_STATUSES as unknown as [string, ...string[]]),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  const before = await getProducerInterest(admin, params.id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const newStatut = parsed.data.statut as (typeof LEAD_STATUSES)[number];

  const result = await updateProducerInterestStatut(admin, params.id, {
    statut: newStatut,
  });
  if (!result.ok) {
    // Aligné avec admin/reviews/moderate : pas d'exposition du message Postgres
    // brut à l'admin, juste un 500 générique + log SRE.
    return NextResponse.json(
      { error: "Internal database error" },
      { status: 500 },
    );
  }

  await logProducerInterestsEvent({
    eventType: "admin_producer_interest_statut_changed",
    userId: session.id,
    metadata: {
      interest_id: params.id,
      email: before.email,
      previous_statut: before.statut,
      new_statut: newStatut,
    },
  });

  return NextResponse.json({ id: params.id, statut: newStatut });
}
