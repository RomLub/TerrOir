"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { logAdminInviteEvent } from "@/lib/audit-logs/log-admin-invite-event";
import { slugFromEmail } from "@/lib/producers/slug-from-email";
import { clearRoleSnapshotOnStore } from "@/lib/auth/role-snapshot-cookie";

export type State = { error?: string };

const schema = z.object({
  token: z.string().min(16, "Token invalide"),
});

// T-303 — bascule auto-upgrade GET → server action POST avec confirmation
// explicite UI. La session de l'utilisateur connecté est l'attestation
// d'intent (un attaquant qui forge un POST sans cookies session échoue
// au check getSessionUser). On re-vérifie aussi token + email match en
// defense in depth.
//
// Pattern symétrique loginAndUpgradeAction (cas consumer-login non-loggé) :
// même mutations idempotentes (roles upsert, producer INSERT draft) +
// audit role_changed conditionnel. Différence clé : pas de signInWithPassword
// (la session existe déjà), pas de check used_at race-loss (la finalisation
// transite par completeOnboardingAction qui marque used_at + a déjà la
// guard SQL .is('used_at', null) côté T-307 mergé).
export async function acceptInvitationAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await getSessionUser();
  if (!session) return { error: "Session expirée" };

  const parsed = schema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Token invalide" };
  }

  const admin = createSupabaseAdminClient();

  const { data: invitation } = await admin
    .from("producer_invitations")
    .select("id, email, expires_at, used_at")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (!invitation) return { error: "Invitation introuvable" };
  if (invitation.used_at) return { error: "Invitation déjà utilisée" };
  if (new Date(invitation.expires_at) < new Date()) {
    // T-081 — audit log forensique : claim ratée pour cause d'expiration.
    // Surface "accept_invitation" = bouton "Devenir producteur" sur la page
    // /invitation après login (consumer existant qui accepte un upgrade).
    // Set cohérent T-081 — 4 sites alignés (create-account, login-and-upgrade,
    // accept-invitation, complete-onboarding). Si un futur 5e chemin de claim
    // est ajouté, ÉTENDRE AdminInviteExpiredSurface dans
    // lib/audit-logs/log-admin-invite-event.ts plutôt que dupliquer
    // l'instrumentation : le compilateur refuse une surface inconnue.
    await logAdminInviteEvent(session.id, {
      type: "admin_invite_expired",
      invitation_id: invitation.id,
      token_prefix: parsed.data.token.substring(0, 8),
      surface: "accept_invitation",
    });
    return { error: "Invitation expirée" };
  }

  // T-110 : comparaison case-insensitive — session.email (Supabase Auth) vs
  // invitation.email (table producer_invitations) peuvent différer en casse.
  // Aligné avec le lookup .ilike sur users plus bas.
  const sessionEmail = (session.email ?? "").toLowerCase();
  const invitationEmail = String(invitation.email ?? "").toLowerCase();
  if (!sessionEmail || sessionEmail !== invitationEmail) {
    return { error: "Email de session ne correspond pas à l'invitation" };
  }

  const { data: existingUser } = await admin
    .from("users")
    .select("id, roles")
    .ilike("email", invitation.email)
    .maybeSingle();

  if (!existingUser) return { error: "Utilisateur introuvable" };

  const currentRoles = Array.isArray(existingUser.roles)
    ? (existingUser.roles as string[])
    : [];

  // Idempotent : si déjà producer, on saute l'UPDATE roles ET le log
  // role_changed (évite la duplication d'event sur double-clic / reclique
  // du lien email après acceptation partielle).
  if (!currentRoles.includes("producer")) {
    const newRoles = Array.from(new Set([...currentRoles, "producer"]));
    const { error: rolesError } = await admin
      .from("users")
      .update({ roles: newRoles })
      .eq("id", existingUser.id);
    if (rolesError) {
      return { error: `Mise à jour rôles échouée : ${rolesError.message}` };
    }

    await logAuthEvent({
      eventType: "role_changed",
      userId: existingUser.id,
      metadata: { from: "consumer", to: "producer" },
    });

    // T-321 — Invalide le cookie role snapshot post-promotion. Le snapshot
    // précédent reflétait roles=['consumer'] ; la prochaine request middleware
    // refera un DB lookup et reposera un cookie frais avec ['consumer',
    // 'producer']. Conditionnel sur !currentRoles.includes('producer') :
    // l'idempotence garde la cohérence côté cookie (pas d'invalidation si
    // pas de changement réel).
    clearRoleSnapshotOnStore(cookies(), headers().get("host"));
  }

  // Idempotent : si une ligne producers existe déjà (flux interrompu, reprise
  // après erreur, etc.), on ne la duplique pas. Sinon création en draft.
  const { data: existingProducer } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", existingUser.id)
    .maybeSingle();

  if (!existingProducer) {
    // TODO Phase 3 finale : retirer prenom_affichage de cet INSERT après le
    // DROP COLUMN producers.prenom_affichage.
    const { error: producerError } = await admin.from("producers").insert({
      user_id: existingUser.id,
      slug: slugFromEmail(invitation.email),
      prenom_affichage: "À compléter",
      nom_exploitation: "À compléter",
      statut: "draft",
    });
    if (producerError) {
      return {
        error: `Fiche producteur non créée : ${producerError.message}`,
      };
    }
  }

  redirect("/onboarding");
}
