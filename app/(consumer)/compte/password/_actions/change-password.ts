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
// Architecture en 2 clients distincts (cf delete-account-action.ts) :
//   - tempClient (anon + persistSession=false) → vérif identité via
//     signInWithPassword(currentPassword) sans toucher les cookies de session.
//   - admin (service_role) → updateUserById(id, { password }) bypass la
//     contrainte Supabase « Secure password change » qui exige AAL2 ou
//     nonce reauthenticate() côté user-client. Légitime car identité déjà
//     vérifiée. Symétrique avec delete-account-action.ts:232.
//
// Validation Zod via strongPasswordSchema : 12+ chars + minuscule + majuscule
// + chiffre (politique progressive chantier 3, 2026-05).
// =============================================================================

import { createElement } from "react";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { strongPasswordSchema } from "@/lib/auth/validators";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { consumeRateLimit, getLoginRateLimit } from "@/lib/rate-limit";
import { sendTemplate } from "@/lib/resend/send";
import PasswordChangedNotice, {
  subject as passwordChangedNoticeSubject,
} from "@/lib/resend/templates/password-changed-notice";

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
  rateLimited?: boolean;
  retryAfterSeconds?: number;
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

  // F-025 (audit P0 sweep 2026-05-11) : rate-limit sur la re-auth password
  // avant d'invoquer tempClient.signInWithPassword. Le re-auth password est
  // équivalent à un login en termes de surface bruteforce (5 attempts/60s
  // keying session.id). Reuse getLoginRateLimit() pour cohérence des caps
  // applicatifs (5/60s).
  const rl = await consumeRateLimit(
    getLoginRateLimit(),
    `change_password:${session.id}`,
  );
  if (!rl.success) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rl.reset - Date.now()) / 1000),
    );
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: session.id,
      metadata: {
        route: "change_password",
        cap: rl.limit,
        reset: rl.reset,
      },
    });
    return {
      error:
        "Trop de tentatives. Patientez quelques instants avant de réessayer.",
      rateLimited: true,
      retryAfterSeconds,
    };
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

  // 4. Update via admin client (service_role). Pourquoi pas le client server
  //    user-side : Supabase Auth a la feature « Secure password change »
  //    activée Dashboard (Authentication > Providers > Email). Quand ON,
  //    PUT /auth/v1/user avec { password } exige soit AAL2 (MFA), soit un
  //    nonce issu d'un flow auth.reauthenticate() (OTP email user-coller).
  //    Notre re-auth tempClient (étape 3) vérifie l'identité mais ne pose
  //    pas le marqueur AAL/nonce sur la session côté cookies — donc un
  //    updateUser via createSupabaseServerClient échoue 400.
  //    Symétrique avec delete-account-action.ts:232 qui appelle
  //    admin.auth.admin.deleteUser après re-auth tempClient.
  const admin = createSupabaseAdminClient();
  const { error: updateError } = await admin.auth.admin.updateUserById(
    session.id,
    { password: parsed.data.newPassword },
  );

  if (updateError) {
    // Trace forensique pour grep alertes Vercel (cf. T-082 audit elargi).
    // Le message brut Supabase peut être anglais ou cryptique — on garde
    // une trace pour comprendre les futurs cas d'échec inattendus.
    console.error(
      `CHANGE_PASSWORD_UPDATE_USER_ERROR user=${maskEmail(session.email)} status=${updateError.status ?? "?"} message=${updateError.message}`,
    );
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

  // 6. F-062 (audit pré-launch 2026-05-11) — notification email post-change.
  // Defense-in-depth : si un attaquant a réussi à passer le re-auth (mdp
  // courant fuite + change ici), l'user titulaire reçoit une trace
  // post-fait + canal support pour récupération.
  // Fail-safe : log warn ne revert pas le succès (le changement est déjà
  // appliqué côté auth — bloquer ici crée une drift UI/auth pire).
  const changedAt = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const noticeProps = { changedAt };
  const noticeResult = await sendTemplate({
    to: session.email,
    userId: session.id,
    template: "password_changed_notice",
    subject: passwordChangedNoticeSubject(noticeProps),
    element: createElement(PasswordChangedNotice, noticeProps),
    metadata: { source: "change_password" },
  });
  if (!noticeResult.ok) {
    console.warn(
      `PASSWORD_CHANGED_NOTICE_SEND_WARN user=${session.id} email=${maskEmail(session.email)} error=${noticeResult.error}`,
    );
  }

  return { success: true };
}
