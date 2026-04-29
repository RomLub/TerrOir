"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invitationLoginAndUpgradeSchema } from "@/lib/auth/validators";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { slugFromEmail } from "@/lib/producers/slug-from-email";

export type State = { error?: string; success?: boolean };

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
    // T-304 : enumeration-resistance. Message générique commun avec le
    // cas signinError pour ne pas distinguer "email inconnu" vs "password
    // incorrect" côté UI. console.warn forensique côté server pour debug.
    console.warn(
      `INVITATION_LOGIN_NO_USER email=${invitation.email}`,
    );
    return { error: "Identifiants incorrects" };
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
    // T-304 : message générique aligné cas !existingUser ci-dessus.
    console.warn(
      `INVITATION_LOGIN_SIGNIN_FAIL email=${invitation.email} message=${signinError.message}`,
    );
    return { error: "Identifiants incorrects" };
  }

  const newRoles = Array.from(new Set([...currentRoles, "producer"]));
  const { error: rolesError } = await admin
    .from("users")
    .update({ roles: newRoles })
    .eq("id", existingUser.id);
  if (rolesError) {
    return { error: `Mise à jour rôles échouée : ${rolesError.message}` };
  }

  // Phase 3 multi-events audit (T-081 PR-A) — promotion consumer→producer.
  // Loggé APRÈS UPDATE roles succès (la transition est effective DB), AVANT
  // INSERT producers (qui peut échouer indépendamment, pas un blocker pour
  // l'event role_changed forensique).
  await logAuthEvent({
    eventType: "role_changed",
    userId: existingUser.id,
    metadata: { from: "consumer", to: "producer" },
  });

  // Si une ligne producers existe déjà (ex: flux interrompu puis repris),
  // on ne la duplique pas. Sinon on la crée en statut='draft'.
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

  return { success: true };
}
