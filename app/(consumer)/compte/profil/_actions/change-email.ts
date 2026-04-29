"use server";

// =============================================================================
// Server action : changement d'email self-service
// =============================================================================
// Bascule depuis l'UPDATE direct public.users.email côté client (legacy bug
// latent — désynchro auth.users ↔ public.users). Le flow nominal :
//   1. supabase.auth.updateUser({ email }) → Supabase envoie 2 emails de
//      confirmation (Secure Email Change Dashboard ON, double confirmation
//      ancienne + nouvelle adresse).
//   2. User clique le lien sur la nouvelle adresse → /auth/callback
//      ?type=email_change → verifyOtp valide, auth.users.email mis à jour.
//   3. Le callback (cf. app/auth/callback/route.ts case email_change)
//      sync alors public.users.email + log l'event audit (instrumentation
//      T-081 PR-A activée naturellement via ce flow).
//
// Pas de re-auth mdp ici : Secure Email Change suffit (double confirmation
// côté Supabase). emailRedirectTo rôle-aware via getAuthCallbackUrl
// (admin → admin.* / autres → www.*).
// =============================================================================

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAuthCallbackUrl } from "@/lib/auth/email-redirect";

export type ChangeEmailState = {
  error?: string;
  message?: string;
};

const changeEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalide"),
});

export async function changeEmailAction(
  _prev: ChangeEmailState,
  formData: FormData,
): Promise<ChangeEmailState> {
  const session = await getSessionUser();
  if (!session || !session.email) {
    return { error: "Session introuvable. Reconnectez-vous." };
  }

  const parsed = changeEmailSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Email invalide" };
  }

  const newEmail = parsed.data.email;
  if (newEmail === session.email.toLowerCase()) {
    return { error: "Le nouvel email est identique à l'actuel." };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: getAuthCallbackUrl(session.isAdmin) },
  );

  if (error) {
    const code = (error as { code?: string }).code;
    if (
      code === "email_exists" ||
      /already (registered|exists)/i.test(error.message)
    ) {
      return { error: "Cet email est déjà utilisé par un autre compte." };
    }
    console.error(
      `CHANGE_EMAIL_ERROR user_id=${session.id} code=${code} message=${error.message}`,
    );
    return { error: "Impossible de changer l'email. Réessayez plus tard." };
  }

  return {
    message: `Email de confirmation envoyé à ${newEmail}. Cliquez sur le lien reçu pour valider le changement.`,
  };
}
