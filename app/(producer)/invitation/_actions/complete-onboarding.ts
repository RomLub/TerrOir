"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { invitationBusinessInfoSchema } from "@/lib/auth/validators";

export type State = { error?: string };

export async function completeOnboardingAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await getSessionUser();
  if (!session) return { error: "Session expirée" };

  const parsed = invitationBusinessInfoSchema.safeParse({
    token: formData.get("token"),
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

  const { data: invitation } = await admin
    .from("producer_invitations")
    .select("id, email, expires_at, used_at")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (!invitation) return { error: "Invitation introuvable" };
  if (invitation.used_at) return { error: "Invitation déjà utilisée" };
  if (new Date(invitation.expires_at) < new Date())
    return { error: "Invitation expirée" };

  if (session.email !== invitation.email) {
    return { error: "Email de session ne correspond pas à l'invitation" };
  }

  const { error: producerError } = await admin
    .from("producers")
    .update({
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

  // On marque used_at SEULEMENT maintenant (pas au créateAccount/login). Cela
  // permet à un utilisateur qui abandonne à l'étape 2 ou 3 de recliquer sur
  // le lien email dans les 7 jours de validité de l'invitation pour reprendre.
  await admin
    .from("producer_invitations")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invitation.id);

  redirect("/ma-page?onboarded=1");
}
