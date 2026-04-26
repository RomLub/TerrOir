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
    return { error: `Profil non créé : ${profileError.message}` };
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
    return { error: `Fiche producteur non créée : ${producerError.message}` };
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
