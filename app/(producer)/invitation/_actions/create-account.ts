"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invitationCreateAccountSchema } from "@/lib/auth/validators";

export type State = { error?: string; success?: boolean };

function slugFromEmail(email: string) {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

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

  const admin = createSupabaseAdminClient();

  const { data: invitation } = await admin
    .from("producer_invitations")
    .select("id, email, expires_at, used_at")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (!invitation) return { error: "Invitation introuvable" };
  if (invitation.used_at) return { error: "Invitation déjà utilisée" };
  if (new Date(invitation.expires_at) < new Date())
    return { error: "Invitation expirée" };

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

  // TODO Phase 3 finale : retirer prenom_affichage de cet INSERT après le
  // DROP COLUMN producers.prenom_affichage.
  const { error: producerError } = await admin.from("producers").insert({
    user_id: userId,
    slug: slugFromEmail(invitation.email),
    prenom_affichage: "À compléter",
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
  const supabase = createSupabaseServerClient();
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
