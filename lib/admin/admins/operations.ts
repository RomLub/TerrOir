import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import AdminLifecycle, {
  subject as adminLifecycleSubject,
  type AdminLifecycleKind,
} from "@/lib/resend/templates/admin-lifecycle";
import {
  logAdminLifecycleEvent,
  type AdminLifecycleEventType,
} from "@/lib/audit-logs/log-admin-lifecycle-event";
import { NEXT_PUBLIC_ADMIN_URL } from "@/lib/env/urls";

// Chantier 6 — orchestration des opérations du cycle de vie admin : appel de
// la RPC SECURITY DEFINER (atomique + gardes serveur), puis email de
// notification (best-effort) + audit log (best-effort). Les routes gardent
// l'auth (session.isAdmin + isSuperAdmin) ; la RPC re-vérifie l'acteur
// (défense en profondeur). Le mapping error_code → message FR est exposé pour
// l'UI.

export type AdminPrivilege = "super_admin" | "standard";

export type AdminOpResult = { ok: true } | { ok: false; errorCode: string };

export const ADMIN_OP_ERROR_MESSAGES: Record<string, string> = {
  forbidden: "Action réservée aux super-administrateurs.",
  self_action: "Vous ne pouvez pas vous appliquer cette action à vous-même.",
  last_super_admin:
    "Impossible : il doit rester au moins un super-administrateur actif.",
  not_admin: "Ce compte n'est pas administrateur.",
  already_admin: "Ce compte est déjà administrateur.",
  target_not_found: "Compte introuvable.",
  no_account:
    "Cet email n'a pas de compte TerrOir. Demandez à la personne de s'inscrire comme client d'abord, puis revenez la promouvoir.",
  has_client_activity:
    "Ce compte a déjà une activité client (commandes, avis). Utilisez une adresse dédiée à l'administration.",
  already_suspended: "Ce compte est déjà suspendu.",
  not_suspended: "Ce compte n'est pas suspendu.",
  no_change: "Aucun changement : le niveau est déjà celui demandé.",
  internal: "Erreur interne. Réessayez ou consultez les logs.",
};

export function adminOpMessage(errorCode: string): string {
  return ADMIN_OP_ERROR_MESSAGES[errorCode] ?? ADMIN_OP_ERROR_MESSAGES.internal;
}

type Identity = { email: string | null; prenom: string | null };

// Envoi best-effort de l'email + audit. Ne fait jamais échouer l'opération
// (la mutation DB est déjà committée).
async function notify(
  kind: AdminLifecycleKind,
  eventType: AdminLifecycleEventType,
  actorId: string,
  targetId: string,
  identity: Identity,
  extra: { newPrivilege?: AdminPrivilege } = {},
): Promise<void> {
  if (identity.email) {
    const props = {
      kind,
      prenom: identity.prenom,
      newPrivilege: extra.newPrivilege,
      adminUrl: NEXT_PUBLIC_ADMIN_URL,
    };
    await sendTemplate({
      to: identity.email,
      userId: targetId,
      template: `admin_lifecycle_${kind}`,
      subject: adminLifecycleSubject(props),
      element: AdminLifecycle(props),
      metadata: { admin_lifecycle_kind: kind, target_user_id: targetId },
    }).catch(() => undefined);
  }
  await logAdminLifecycleEvent({
    eventType,
    userId: actorId,
    metadata: {
      target_user_id: targetId,
      target_email: identity.email,
      ...(extra.newPrivilege ? { new_privilege: extra.newPrivilege } : {}),
    },
  });
}

function rpcResult(data: unknown): AdminOpResult {
  const r = data as { ok?: boolean; error_code?: string } | null;
  if (r?.ok) return { ok: true };
  return { ok: false, errorCode: r?.error_code ?? "internal" };
}

// Promotion d'un compte client (par email) en admin.
export async function promoteAdminByEmail(
  actorId: string,
  email: string,
  privilege: AdminPrivilege = "standard",
): Promise<AdminOpResult> {
  const admin = createSupabaseAdminClient();
  const normalized = email.trim().toLowerCase();

  // Résolution email → compte. Refus clair si aucun compte (point 3 spec).
  const { data: userRow } = await admin
    .from("users")
    .select("id, email, prenom")
    .ilike("email", normalized)
    .maybeSingle();

  if (!userRow) {
    const { data: existingAdmin } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", normalized)
      .maybeSingle();
    if (existingAdmin) return { ok: false, errorCode: "already_admin" };
    return { ok: false, errorCode: "no_account" };
  }

  const target = userRow as { id: string; email: string | null; prenom: string | null };
  const { data, error } = await admin.rpc("admin_promote_user", {
    p_actor: actorId,
    p_target: target.id,
    p_privilege: privilege,
  });
  if (error) {
    console.error(`[ADMIN_PROMOTE_RPC_ERR] ${error.message}`);
    return { ok: false, errorCode: "internal" };
  }
  const result = rpcResult(data);
  if (result.ok) {
    await notify("promoted", "admin_promoted", actorId, target.id, {
      email: target.email,
      prenom: target.prenom,
    });
  }
  return result;
}

// Helper : capture l'identité (email/prenom) d'un admin AVANT l'opération
// (nécessaire pour l'email, et après un retrait la ligne a migré).
async function adminIdentity(targetId: string): Promise<Identity | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("admin_users")
    .select("email, prenom")
    .eq("id", targetId)
    .maybeSingle();
  return (data as Identity | null) ?? null;
}

async function runAdminRpc(
  fn: "admin_suspend" | "admin_reactivate" | "admin_revoke",
  actorId: string,
  targetId: string,
): Promise<{ result: AdminOpResult; identity: Identity | null }> {
  const admin = createSupabaseAdminClient();
  const identity = await adminIdentity(targetId);
  const { data, error } = await admin.rpc(fn, {
    p_actor: actorId,
    p_target: targetId,
  });
  if (error) {
    console.error(`[ADMIN_OP_RPC_ERR] fn=${fn} ${error.message}`);
    return { result: { ok: false, errorCode: "internal" }, identity };
  }
  return { result: rpcResult(data), identity };
}

export async function suspendAdmin(
  actorId: string,
  targetId: string,
): Promise<AdminOpResult> {
  const { result, identity } = await runAdminRpc("admin_suspend", actorId, targetId);
  if (result.ok && identity) {
    await notify("suspended", "admin_suspended", actorId, targetId, identity);
  }
  return result;
}

export async function reactivateAdmin(
  actorId: string,
  targetId: string,
): Promise<AdminOpResult> {
  const { result, identity } = await runAdminRpc(
    "admin_reactivate",
    actorId,
    targetId,
  );
  if (result.ok && identity) {
    await notify("reactivated", "admin_reactivated", actorId, targetId, identity);
  }
  return result;
}

export async function revokeAdmin(
  actorId: string,
  targetId: string,
): Promise<AdminOpResult> {
  const { result, identity } = await runAdminRpc("admin_revoke", actorId, targetId);
  if (result.ok && identity) {
    await notify("revoked", "admin_revoked", actorId, targetId, identity);
  }
  return result;
}

export async function setAdminPrivilege(
  actorId: string,
  targetId: string,
  privilege: AdminPrivilege,
): Promise<AdminOpResult> {
  const admin = createSupabaseAdminClient();
  const identity = await adminIdentity(targetId);
  const { data, error } = await admin.rpc("admin_set_privilege", {
    p_actor: actorId,
    p_target: targetId,
    p_privilege: privilege,
  });
  if (error) {
    console.error(`[ADMIN_SET_PRIVILEGE_RPC_ERR] ${error.message}`);
    return { ok: false, errorCode: "internal" };
  }
  const result = rpcResult(data);
  if (result.ok && identity) {
    await notify(
      "privilege_changed",
      "admin_privilege_changed",
      actorId,
      targetId,
      identity,
      { newPrivilege: privilege },
    );
  }
  return result;
}
