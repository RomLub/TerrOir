"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

// Action serveur de l'étape 2 du flow reset password (étape 1 = email envoyé
// depuis /mot-de-passe-oublie). Reçoit le token_hash recovery transmis par
// Supabase via l'URL d'email + le nouveau mot de passe + sa confirmation.
//
// Pourquoi tout faire dans la même server action plutôt que séparer la
// vérif OTP et l'update : verifyOtp consomme le token (one-shot) et écrit
// les cookies de session. En page server component, cookies().set() est
// read-only (pattern Next.js App Router) — la session ne tiendrait pas
// jusqu'au submit du form. Tout regrouper ici garantit que les cookies
// posés par verifyOtp restent disponibles pour le updateUser qui suit.

const updatePasswordSchema = z
  .object({
    token_hash: z.string().min(10, "Token invalide"),
    password: z.string().min(8, "Mot de passe : 8 caractères minimum"),
    passwordConfirm: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: "Les mots de passe ne correspondent pas",
    path: ["passwordConfirm"],
  });

export type UpdatePasswordState = {
  error?: string;
  expired?: boolean;
};

export async function updatePasswordAction(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const parsed = updatePasswordSchema.safeParse({
    token_hash: formData.get("token_hash"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const supabase = createSupabaseServerClient();

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: parsed.data.token_hash,
  });

  if (verifyError) {
    return {
      error:
        "Lien de réinitialisation expiré ou déjà utilisé. Demandez un nouveau lien.",
      expired: true,
    };
  }

  const { data: updateData, error: updateError } =
    await supabase.auth.updateUser({
      password: parsed.data.password,
    });

  if (updateError) {
    return {
      error: "Impossible de mettre à jour le mot de passe. Réessayez.",
    };
  }

  await logAuthEvent({
    eventType: "password_changed",
    userId: updateData.user?.id ?? null,
  });

  redirect("/compte?password=updated");
}
