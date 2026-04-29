"use server";

// =============================================================================
// Server action : changement de mot de passe (compte/password)
// =============================================================================
// Refonte server-side du flow client précédent qui appelait directement
// supabase.auth.signInWithPassword côté navigateur. Conséquences évitées :
//   1. Cookies de session reposés inutilement (signInWithPassword crée une
//      nouvelle session côté client) → re-auth via tempClient persistSession=false.
//   2. Rate-limit Supabase login parasite — chaque retentative mauvais mdp
//      consommait le quota /token côté project, pouvant bloquer l'user.
//   3. Pas d'audit log password_changed (asymétrie avec recovery flow
//      update-password.ts:75-78). Désormais loggué après succès updateUser.
//   4. Logique re-auth déportée serveur → cohérence avec
//      delete-account-action.ts:104-117 (même pattern client temp).
//
// Validation Zod via strongPasswordSchema : 8+ chars + minuscule + majuscule
// + chiffre, aligné Dashboard Supabase 29/04/2026 (T-312 partiel).
// =============================================================================

import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { strongPasswordSchema } from "@/lib/auth/validators";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis"),
    newPassword: strongPasswordSchema,
    newPasswordConfirm: z.string(),
  })
  .refine((d) => d.newPassword === d.newPasswordConfirm, {
    message: "Les deux nouveaux mots de passe ne correspondent pas",
    path: ["newPasswordConfirm"],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "Le nouveau mot de passe doit être différent de l'actuel",
    path: ["newPassword"],
  });

export type ChangePasswordState = {
  error?: string;
  success?: boolean;
};

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  // 1. Session courante côté serveur
  const session = await getSessionUser();
  if (!session || !session.email) {
    return { error: "Session introuvable. Reconnectez-vous." };
  }

  // 2. Parse + validation Zod (complexité + match + différence)
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordConfirm: formData.get("newPasswordConfirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  // 3. Re-auth via client temporaire (anon + persistSession=false) —
  //    pattern référence delete-account-action.ts:104-117. Vérifie le mdp
  //    actuel sans toucher aux cookies de session côté navigateur.
  const tempClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error: signInError } = await tempClient.auth.signInWithPassword({
    email: session.email,
    password: parsed.data.currentPassword,
  });

  if (signInError) {
    return { error: "Mot de passe actuel incorrect." };
  }

  // 4. Update via client server authentifié (auth.uid() = session.id).
  //    Pas d'admin client : c'est l'user lui-même qui change son mdp,
  //    pas un override admin.
  const supabase = createSupabaseServerClient();
  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateError) {
    // Mapping FR au cas où la politique complexité Supabase évolue
    // au-delà du Zod local — évite de remonter le message brut anglais.
    const msg = updateError.message ?? "";
    if (/password/i.test(msg) && /weak|strong|requirement|character/i.test(msg)) {
      return {
        error:
          "Le mot de passe ne respecte pas les règles de sécurité. Réessayez avec un mot de passe plus complexe.",
      };
    }
    return { error: "Impossible de mettre à jour le mot de passe. Réessayez." };
  }

  // 5. Audit log (cohérent recovery flow update-password.ts:75-78)
  await logAuthEvent({
    eventType: "password_changed",
    userId: session.id,
  });

  return { success: true };
}
