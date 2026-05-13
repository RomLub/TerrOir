import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import { deleteProducerInterest } from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";

// Route admin /api/admin/producer-interests/[id] — refactor PR1
// admin-pattern-uniform.
//
// DELETE : suppression définitive d'un lead producteur + audit log
//          admin_producer_interest_deleted (snapshot complet pour
//          traçabilité forensique en cas de suppression accidentelle).
//
// Pré-SELECT obligatoire pour :
//   - répondre 404 si l'interest n'existe pas,
//   - capturer le snapshot complet (email, source, statut, created_at)
//     AVANT que la row ne disparaisse — la metadata audit doit pouvoir
//     servir à reconstituer le lead supprimé.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  const before = await getProducerInterest(admin, params.id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await deleteProducerInterest(admin, params.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Internal database error" },
      { status: 500 },
    );
  }

  await logProducerInterestsEvent({
    eventType: "admin_producer_interest_deleted",
    userId: session.id,
    metadata: {
      interest_id: params.id,
      email: before.email,
      source: before.source,
      statut: before.statut,
      created_at: before.created_at,
    },
  });

  return NextResponse.json({ id: params.id });
}
