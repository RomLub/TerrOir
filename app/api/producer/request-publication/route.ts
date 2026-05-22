import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logProducersAdminEvent } from "@/lib/audit-logs/log-producers-admin-event";

// POST /api/producer/request-publication — le producteur demande la mise en
// ligne de sa fiche. La RPC SECDEF request_publication vérifie les 6 critères
// côté serveur (description ≥150, photo couverture, ≥1 produit avec photo,
// commune+CP, créneau ouvert, Stripe activé) et pose publication_requested_at
// uniquement si tout est OK ; sinon renvoie la liste des manques (→ 422).
//
// Appel via client service_role + p_user_id de confiance (extrait de la
// session serveur), même pattern que update_producer_onboarding. SECDEF +
// service_role ⇒ le trigger producers_block_owner_admin_columns bypasse pour
// poser publication_requested_at (colonne admin-only en écriture directe).

type RpcResult =
  | { ok: true; already_public?: boolean; publication_requested_at?: string }
  | { ok: false; missing?: string[]; blocked?: string };

export async function POST() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("request_publication", {
    p_user_id: session.id,
  });

  if (error) {
    console.error(
      `[REQUEST_PUBLICATION_RPC_ERR] user=${session.id} error=${error.message}`,
    );
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }

  const result = data as RpcResult;

  if (!result || result.ok !== true) {
    // Critères manquants ou statut bloqué → 422 (non actionnable côté client
    // sans corriger le profil). On renvoie la liste exacte pour l'UI.
    return NextResponse.json(
      {
        ok: false,
        missing: (result && "missing" in result && result.missing) || [],
        blocked: (result && "blocked" in result && result.blocked) || null,
      },
      { status: 422 },
    );
  }

  // Demande enregistrée (nouvelle). Si déjà public, pas de nouvel event.
  if (!result.already_public) {
    await logProducersAdminEvent({
      eventType: "producer_publication_requested",
      userId: session.id,
      metadata: {
        publication_requested_at: result.publication_requested_at ?? null,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    already_public: result.already_public ?? false,
    publication_requested_at: result.publication_requested_at ?? null,
  });
}
