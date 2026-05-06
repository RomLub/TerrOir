"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { signupSchema } from "@/lib/auth/validators";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import { consumeRateLimit, getSignupRateLimit } from "@/lib/rate-limit";
import {
  extractRequestContext,
  logAuthEvent,
} from "@/lib/audit-logs/log-auth-event";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

export type SignupState = {
  error?: string;
  success?: { email: string };
};

export async function signupAction(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    email: formData.get("email"),
    password: formData.get("password"),
    telephone: formData.get("telephone") ?? "",
    sms_optin: formData.get("sms_optin") ?? false,
    cgu_accepted: formData.get("cgu_accepted") ?? false,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  // T-305 PR-B : rate-limit applicatif IP avant tout call Supabase coûteux.
  // Cap 5/60s (cf. lib/rate-limit.ts getSignupRateLimit). Fail-open Redis
  // indispo — un incident Upstash ne bloque pas la signup. Audit log
  // rate_limit_exceeded émis sur cap reached pour détection forensique.
  const { ipAddress } = extractRequestContext(headers());
  const rateLimit = await consumeRateLimit(
    getSignupRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rateLimit.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: {
        route: "signup",
        cap: rateLimit.limit,
        reset: rateLimit.reset,
      },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const { prenom, nom, email, password, telephone, sms_optin } = parsed.data;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { prenom, nom },
      emailRedirectTo: `${NEXT_PUBLIC_APP_URL}/auth/callback?next=/compte/commandes`,
    },
  });

  if (error || !data.user) {
    // T-313 : enumeration-resistance. Si l'email est déjà enregistré,
    // Supabase remonte "User already registered" (code user_already_exists).
    // On simule un succès identique au flow nominal pour ne pas révéler
    // l'existence d'un compte. L'utilisateur honnête qui s'est trompé
    // d'identifiant verra "Mail envoyé" mais ne recevra pas le mail —
    // l'attaquant scriptant signup ne peut pas distinguer "email connu"
    // de "email nouveau". Pattern aligné resetPasswordForEmail
    // (cf. mot-de-passe-oublie/page.tsx).
    const code = (error as { code?: string } | undefined)?.code;
    if (
      code === "user_already_exists" ||
      (error?.message && /already (registered|exists)/i.test(error.message))
    ) {
      console.warn(
        `SIGNUP_DUP_EMAIL email=${email} code=${code ?? "n/a"}`,
      );
      return { success: { email } };
    }
    if (error) {
      console.error(
        `SIGNUP_ERROR email=${email} code=${code ?? "n/a"} message=${error.message}`,
      );
    }
    return { error: "Inscription impossible. Réessayez plus tard." };
  }

  // Profil public.users — créé via service_role pour contourner la
  // contrainte RLS (auth.uid() peut ne pas être disponible immédiatement
  // après signUp avec enable_confirmations=ON, l'user n'a pas encore
  // de session active).
  const admin = createSupabaseAdminClient();
  const { error: profileError } = await admin.from("users").insert({
    id: data.user.id,
    email,
    roles: ["consumer"],
    prenom,
    nom,
    telephone: telephone ?? null,
    sms_optin: Boolean(sms_optin),
    cgu_accepted_at: new Date().toISOString(),
    cgu_version: LEGAL_VERSIONS.CGU,
  });

  if (profileError) {
    // T-301 : compensation orphelin. signUp() a réussi côté auth.users
    // mais l'INSERT public.users a échoué — un user half-created bloque
    // l'utilisateur (impossible de re-signup avec le même email tant que
    // auth.users persiste). Rollback via Admin API. Le pattern ne tente
    // PAS de retry l'insert : la cause de l'échec (RLS, contrainte
    // unique, DB down) ne s'évanouira pas en quelques ms.
    const { error: rollbackError } = await admin.auth.admin.deleteUser(
      data.user.id,
    );
    if (rollbackError) {
      console.error(
        `SIGNUP_ORPHAN_AUTH user_id=${data.user.id} email=${email} ` +
          `profile_error=${profileError.message} rollback_error=${rollbackError.message}`,
      );
    }
    return { error: "Inscription impossible. Réessayez plus tard." };
  }

  // Pas de revalidatePath / redirect ici : Confirm Email Dashboard ON →
  // signUp() ne pose PAS de cookies de session, l'utilisateur n'est pas
  // loggué tant qu'il n'a pas cliqué le lien dans le mail. L'event
  // audit account_signup est instrumenté côté /auth/callback case
  // type=signup post-confirmation (signup réel ≠ signup pending).
  return { success: { email } };
}
