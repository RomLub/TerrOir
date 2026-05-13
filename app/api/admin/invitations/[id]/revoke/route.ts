import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

// POST /api/admin/invitations/[id]/revoke — chantier PR3
// feature/admin-new-surfaces (audit AUDIT_ADMIN § 6 P1 #6).
//
// Pattern WRITE admin canonique (cohérent avec PR1 producers/[id]/statut) :
// auth check explicit session.isAdmin → pre-SELECT (404 + before snapshot)
// → validation transition côté applicatif → UPDATE service_role → audit
// log → revalidation.
//
// Validation transition (CRITIQUE — défense en profondeur) :
//   - used_at IS NOT NULL  → 409 Conflict, AUCUNE modification DB.
//     Le CHECK constraint `producer_invitations_revoke_consume_exclusive`
//     de la migration PR3 est la 2e ligne ; ce 409 garantit qu'on n'écrit
//     même pas une row qui violerait le CHECK (et qu'on retourne un
//     message UX exploitable plutôt qu'une erreur DB générique).
//   - revoked_at IS NOT NULL → 200 noop, action idempotente (pas d'erreur).
//   - sinon → UPDATE revoked_at = now() + audit log invitation_revoked.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, props: RouteContext) {
  const { id } = await props.params;

  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  // Pre-SELECT : 404 si l'invitation n'existe pas + capture before pour
  // détecter consumed / déjà revoked / état nominal, et embarquer les
  // colonnes pertinentes dans l'audit log (email, expires_at).
  const { data: before, error: selectError } = await admin
    .from("producer_invitations")
    .select("id, email, expires_at, used_at, revoked_at")
    .eq("id", id)
    .maybeSingle();

  if (selectError) {
    return dbErrorResponse(selectError, "ADMIN_INVITATION_REVOKE_SELECT", {
      admin_id: session.id,
      invitation_id: id,
    });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Défense en profondeur : invitation déjà consommée → 409 sans rien
  // modifier. Le CHECK DB est la 2e ligne (le UPDATE serait bloqué par
  // le constraint, mais on veut un message UX clair plutôt qu'une erreur
  // 500 Postgres).
  if (before.used_at !== null) {
    return NextResponse.json(
      {
        error: "Invitation déjà consommée, impossible de révoquer",
      },
      { status: 409 },
    );
  }

  // Idempotence : déjà révoquée → 200 noop. Pas d'audit log (event déjà
  // émis lors de la 1re révocation), pas de revalidate.
  if (before.revoked_at !== null) {
    return NextResponse.json({
      id,
      revoked_at: before.revoked_at,
      noop: true,
    });
  }

  // Cas nominal : UPDATE revoked_at = now().
  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("producer_invitations")
    .update({ revoked_at: nowIso })
    .eq("id", id);

  if (updateError) {
    return dbErrorResponse(updateError, "ADMIN_INVITATION_REVOKE_UPDATE", {
      admin_id: session.id,
      invitation_id: id,
    });
  }

  // Audit log — l'event `invitation_revoked` est pré-déclaré dans
  // log-auth-event.ts ligne ~63. metadata embarque les infos nécessaires
  // pour grep forensique (corrélation avec invitation_created éventuel).
  await logAuthEvent({
    eventType: "invitation_revoked",
    userId: session.id,
    metadata: {
      invitation_id: id,
      email: before.email,
      expires_at: before.expires_at,
    },
  });

  revalidatePath("/invitations");

  return NextResponse.json({ id, revoked_at: nowIso });
}
