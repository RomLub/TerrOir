"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { invitationBusinessInfoSchema } from "@/lib/auth/validators";
import { maskEmail } from "@/lib/rgpd/mask-email";

export type State = { error?: string };

export async function completeOnboardingAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await getSessionUser();
  if (!session) return { error: "Session expirée" };

  const parsed = invitationBusinessInfoSchema.safeParse({
    token: formData.get("token"),
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    telephone: formData.get("telephone"),
    prenom_affichage: formData.get("prenom_affichage"),
    nom_exploitation: formData.get("nom_exploitation"),
    forme_juridique: formData.get("forme_juridique"),
    siret: formData.get("siret"),
    adresse: formData.get("adresse"),
    code_postal: formData.get("code_postal"),
    commune: formData.get("commune"),
    type_production: formData.get("type_production"),
    type_production_precision:
      formData.get("type_production_precision") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const admin = createSupabaseAdminClient();
  const token = parsed.data.token?.trim();

  // On retient l'invitation à marquer used_at SI on est en flux classique
  // (token présent). En flux reprise (Phase 4), pas d'invitation à marquer.
  let invitationId: string | null = null;

  if (token) {
    const { data: invitation } = await admin
      .from("producer_invitations")
      .select("id, email, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();

    if (!invitation) return { error: "Invitation introuvable" };
    if (invitation.used_at) return { error: "Invitation déjà utilisée" };
    if (new Date(invitation.expires_at) < new Date())
      return { error: "Invitation expirée" };

    if (session.email !== invitation.email) {
      return { error: "Email de session ne correspond pas à l'invitation" };
    }
    invitationId = invitation.id as string;
  } else {
    const { data: producer } = await admin
      .from("producers")
      .select("statut")
      .eq("user_id", session.id)
      .maybeSingle();

    if (!producer) return { error: "Aucun profil producteur à compléter" };
    if (producer.statut !== "draft") {
      return { error: "Profil producteur déjà finalisé" };
    }
  }

  // Étape unique post-compte (Phase 2 wizard 2 étapes) : on écrit d'abord les
  // infos perso dans `users`, puis les infos business dans `producers`. Ordre
  // important : si l'update users échoue, on n'a pas encore basculé le
  // producer en 'pending', donc l'utilisateur peut retenter sans incohérence.
  const { error: userError } = await admin
    .from("users")
    .update({
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      telephone: parsed.data.telephone,
    })
    .eq("id", session.id);

  if (userError) {
    return { error: `Mise à jour des infos personnelles échouée : ${userError.message}` };
  }

  const { error: producerError } = await admin
    .from("producers")
    .update({
      prenom_affichage: parsed.data.prenom_affichage,
      nom_exploitation: parsed.data.nom_exploitation,
      forme_juridique: parsed.data.forme_juridique,
      siret: parsed.data.siret,
      adresse: parsed.data.adresse,
      code_postal: parsed.data.code_postal,
      commune: parsed.data.commune,
      type_production: parsed.data.type_production,
      type_production_precision:
        parsed.data.type_production === "autre"
          ? parsed.data.type_production_precision
          : null,
      statut: "pending",
    })
    .eq("user_id", session.id);

  if (producerError) {
    return { error: `Finalisation échouée : ${producerError.message}` };
  }

  // On marque used_at SEULEMENT maintenant (pas au createAccount/login). Cela
  // permet à un utilisateur qui abandonne à l'étape 2 ou 3 de recliquer sur
  // le lien email dans les 7 jours de validité de l'invitation pour reprendre.
  if (invitationId) {
    await admin
      .from("producer_invitations")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invitationId);
  }

  // Bump du lead matching : producer_interests.statut 'contacted' → 'onboarded'.
  // Match email case-insensitive (ilike sans wildcards), scope strict à 'contacted'
  // pour rester cohérent avec le flow normal (new → contacted → onboarded).
  // Si 0 rows (producer invité direct sans lead, ou déjà en 'onboarded'), no-op
  // silencieux. Si échec DB, on log mais on ne bloque pas la finalisation
  // wizard — l'onboarding producer a réussi, le bump lead est nice-to-have.
  if (session.email) {
    const { data: bumped, error: bumpError } = await admin
      .from("producer_interests")
      .update({ statut: "onboarded" })
      .ilike("email", session.email)
      .eq("statut", "contacted")
      .select("id");
    if (bumpError) {
      console.warn(
        `[LEAD_ONBOARDED_WARN] Failed to bump producer_interests for ${maskEmail(session.email)}: ${bumpError.message}`,
      );
    } else if ((bumped?.length ?? 0) > 0) {
      console.info(
        `[LEAD_ONBOARDED] Bumped ${bumped?.length} lead(s) to 'onboarded' for ${maskEmail(session.email)}`,
      );
    }
  }

  redirect("/ma-page?onboarded=1");
}
