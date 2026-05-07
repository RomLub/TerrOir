"use server";

import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invitationCreateAccountSchema } from "@/lib/auth/validators";
import { slugFromEmail } from "@/lib/producers/slug-from-email";
import { consumeRateLimit, getSignupRateLimit } from "@/lib/rate-limit";
import {
  extractRequestContext,
  logAuthEvent,
} from "@/lib/audit-logs/log-auth-event";
import { logAdminInviteEvent } from "@/lib/audit-logs/log-admin-invite-event";

export type State = { error?: string; success?: boolean };

export async function createAccountAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const parsed = invitationCreateAccountSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  // T-305 PR-B : rate-limit applicatif IP avant lookup invitation +
  // createUser. Mutualise getSignupRateLimit() (D3) — flow signup invitation
  // partage la même surface attaque que signup classique côté IP.
  const { ipAddress } = extractRequestContext(await headers());
  const rateLimit = await consumeRateLimit(
    getSignupRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rateLimit.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: {
        route: "invitation_create",
        cap: rateLimit.limit,
        reset: rateLimit.reset,
      },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
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
    // userId = null (l'user n'a pas encore de compte créé, il essaie d'en
    // créer un via le lien expiré). Surface "create_account" = formulaire
    // "Créer mon compte producteur" pour un email pas encore connu.
    // Set cohérent T-081 — 4 sites alignés (cf. note dans
    // lib/audit-logs/log-admin-invite-event.ts AdminInviteExpiredSurface).
    await logAdminInviteEvent(null, {
      type: "admin_invite_expired",
      invitation_id: invitation.id,
      token_prefix: parsed.data.token.substring(0, 8),
      surface: "create_account",
    });
    return { error: "Invitation expirée" };
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: invitation.email,
      password: parsed.data.password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    return {
      error: createError?.message ?? "Création utilisateur impossible",
    };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("users").insert({
    id: userId,
    email: invitation.email,
    roles: ["consumer", "producer"],
  });
  if (profileError) {
    // T-302 : compensation orphelin. createUser() a réussi côté auth.users
    // mais l'INSERT public.users a échoué — sans rollback, le user reste
    // bloqué (impossible de re-créer un compte avec ce token tant que
    // auth.users persiste). Pattern aligné T-301 (cf.
    // app/(consumer)/auth/inscription/actions.ts:84-101).
    const { error: rollbackError } =
      await admin.auth.admin.deleteUser(userId);
    if (rollbackError) {
      console.error(
        `INVITATION_CREATE_ACCOUNT_ORPHAN_AUTH user_id=${userId} email=${invitation.email} ` +
          `profile_error=${profileError.message} rollback_error=${rollbackError.message}`,
      );
    }
    return { error: "Création du compte impossible. Réessayez plus tard." };
  }

  const { error: producerError } = await admin.from("producers").insert({
    user_id: userId,
    slug: slugFromEmail(invitation.email),
    nom_exploitation: "À compléter",
    statut: "draft",
  });
  if (producerError) {
    // T-302 : compensation orphelin (post-INSERT users OK). Le rollback
    // auth.users CASCADE sur public.users.id et producers.user_id (cf.
    // migrations 20260419 + 20260421) supprime aussi les lignes
    // partiellement créées.
    const { error: rollbackError } =
      await admin.auth.admin.deleteUser(userId);
    if (rollbackError) {
      console.error(
        `INVITATION_CREATE_ACCOUNT_ORPHAN_AUTH_AFTER_PROFILE user_id=${userId} email=${invitation.email} ` +
          `producer_error=${producerError.message} rollback_error=${rollbackError.message}`,
      );
    }
    return { error: "Création du compte impossible. Réessayez plus tard." };
  }

  // Dépose les cookies de session pour que les étapes 2 et 3 puissent
  // lire getSessionUser().
  const supabase = await createSupabaseServerClient();
  const { error: signinError } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password: parsed.data.password,
  });
  if (signinError) {
    return {
      error:
        "Compte créé mais connexion échouée. Reconnectez-vous via l'écran de connexion.",
    };
  }

  return { success: true };
}
