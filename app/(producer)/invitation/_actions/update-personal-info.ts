"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { invitationPersonalInfoSchema } from "@/lib/auth/validators";

export type State = { error?: string; success?: boolean };

export async function updatePersonalInfoAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await getSessionUser();
  if (!session) return { error: "Session expirée" };

  const parsed = invitationPersonalInfoSchema.safeParse({
    token: formData.get("token"),
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    telephone: formData.get("telephone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const admin = createSupabaseAdminClient();

  const { data: invitation } = await admin
    .from("producer_invitations")
    .select("email, expires_at, used_at")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (!invitation) return { error: "Invitation introuvable" };
  if (invitation.used_at) return { error: "Invitation déjà utilisée" };
  if (new Date(invitation.expires_at) < new Date())
    return { error: "Invitation expirée" };

  if (session.email !== invitation.email) {
    return { error: "Email de session ne correspond pas à l'invitation" };
  }

  const { error: updateError } = await admin
    .from("users")
    .update({
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      telephone: parsed.data.telephone,
    })
    .eq("id", session.id);

  if (updateError) return { error: updateError.message };
  return { success: true };
}
