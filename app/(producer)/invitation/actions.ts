"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptInvitationSchema } from "@/lib/auth/validators";

export type AcceptState = { error?: string };

function slugFromEmail(email: string) {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function acceptInvitationAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const parsed = acceptInvitationSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const admin = createSupabaseAdminClient();

  // 1. Vérifier le token
  const { data: invitation } = await admin
    .from("producer_invitations")
    .select("id, email, expires_at, used_at")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (!invitation) {
    return { error: "Invitation introuvable" };
  }
  if (invitation.used_at) {
    return { error: "Invitation déjà utilisée" };
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return { error: "Invitation expirée" };
  }

  // 2. Créer l'utilisateur auth (e-mail déjà confirmé car invité par l'admin)
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: invitation.email,
      password: parsed.data.password,
      email_confirm: true,
    });

  if (createError || !created.user) {
    return { error: createError?.message ?? "Création utilisateur impossible" };
  }

  const userId = created.user.id;

  // 3. Insérer profil users + producers (row vide à compléter sur /ma-page)
  //    Le producteur est aussi consumer par défaut — rôles cumulables.
  const { error: profileError } = await admin.from("users").insert({
    id: userId,
    email: invitation.email,
    roles: ["consumer", "producer"],
  });
  if (profileError) {
    return { error: `Profil non créé : ${profileError.message}` };
  }

  const { error: producerError } = await admin.from("producers").insert({
    user_id: userId,
    slug: slugFromEmail(invitation.email),
    nom_exploitation: "À compléter",
  });
  if (producerError) {
    return {
      error: `Fiche producteur non créée : ${producerError.message}`,
    };
  }

  // 4. Marquer l'invitation comme utilisée
  await admin
    .from("producer_invitations")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // 5. Connecter le nouveau producteur (dépose les cookies via le client serveur)
  const supabase = createSupabaseServerClient();
  const { error: signinError } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password: parsed.data.password,
  });
  if (signinError) {
    // Compte bien créé, connexion manuelle possible via /connexion
    redirect("/connexion");
  }

  redirect("/ma-page");
}
