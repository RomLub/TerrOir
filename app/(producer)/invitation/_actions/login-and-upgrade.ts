"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invitationLoginAndUpgradeSchema } from "@/lib/auth/validators";

export type State = { error?: string; success?: boolean };

function slugFromEmail(email: string) {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function loginAndUpgradeAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const parsed = invitationLoginAndUpgradeSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
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

  const { data: existingUser } = await admin
    .from("users")
    .select("id, roles")
    .eq("email", invitation.email)
    .maybeSingle();

  if (!existingUser) {
    return { error: "Aucun compte trouvé avec cet email" };
  }

  const currentRoles = Array.isArray(existingUser.roles)
    ? (existingUser.roles as string[])
    : [];

  // NOTE: pas de check "déjà producteur" ici — il est fait côté page.tsx
  // en distinguant producer.statut === 'draft' (onboarding en cours, on laisse
  // passer pour permettre la reprise) vs statut non-draft (vraiment déjà
  // inscrit, page.tsx affiche l'ErrorCard avant d'atteindre ce formulaire).
  // Cette action est idempotente : upsert roles via Set, insert producer
  // conditionnel.

  const supabase = createSupabaseServerClient();
  const { error: signinError } = await supabase.auth.signInWithPassword({
    email: invitation.email,
    password: parsed.data.password,
  });
  if (signinError) {
    return { error: "Mot de passe incorrect" };
  }

  const newRoles = Array.from(new Set([...currentRoles, "producer"]));
  const { error: rolesError } = await admin
    .from("users")
    .update({ roles: newRoles })
    .eq("id", existingUser.id);
  if (rolesError) {
    return { error: `Mise à jour rôles échouée : ${rolesError.message}` };
  }

  // Si une ligne producers existe déjà (ex: flux interrompu puis repris),
  // on ne la duplique pas. Sinon on la crée en statut='draft'.
  const { data: existingProducer } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", existingUser.id)
    .maybeSingle();

  if (!existingProducer) {
    const { error: producerError } = await admin.from("producers").insert({
      user_id: existingUser.id,
      slug: slugFromEmail(invitation.email),
      nom_exploitation: "À compléter",
      statut: "draft",
    });
    if (producerError) {
      return {
        error: `Fiche producteur non créée : ${producerError.message}`,
      };
    }
  }

  return { success: true };
}
