"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loginSchema } from "@/lib/auth/validators";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import {
  loadRoleSnapshot,
  resolvePostLoginPath,
} from "@/lib/auth/post-login-redirect";
import { setRedirectAfterAuth } from "@/lib/auth/redirect-cookie";
import { setRoleSnapshotOnStore } from "@/lib/auth/role-snapshot-cookie";
import {
  getAuthCallbackUrl,
  getPasswordResetUrl,
} from "@/lib/auth/email-redirect";

export type LoginState = { error?: string };

// T-309 : classification catégorielle EN-neutre des erreurs signinError pour
// metadata.reason_code audit_logs login_failed. Mirror style inline T-318
// classifyAuthError (cf. app/auth/callback/route.ts) — sémantique distincte
// (token vs credentials) donc pas réutilisable. UI-facing message FR
// "Identifiants invalides" reste générique côté retour LoginState.
type LoginErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "technical";

function classifyLoginError(
  code: string | null | undefined,
  message: string | null | undefined,
): LoginErrorCode {
  if (code === "invalid_credentials") return "invalid_credentials";
  if (code === "email_not_confirmed") return "email_not_confirmed";
  if (
    code?.includes("rate_limit") ||
    message?.toLowerCase().includes("rate limit")
  ) {
    return "rate_limited";
  }
  return "technical";
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // Audit forensique : on logue chaque tentative échouée pour permettre
    // détection brute-force / énumération. email plaintext OK en metadata
    // audit_logs (convention TerrOir, cf. magic link), userId null (user
    // pas authentifié). reason_code catégoriel évite la dépendance directe
    // aux codes Supabase verbatim côté analytics. logAuthEvent est fail-safe
    // (swallow + warn) — un échec d'écriture audit ne bloque pas le retour
    // d'erreur UI.
    await logAuthEvent({
      eventType: "login_failed",
      userId: null,
      metadata: {
        email: parsed.data.email,
        reason_code: classifyLoginError(error?.code, error?.message),
      },
    });
    return { error: "Identifiants invalides" };
  }

  await logAuthEvent({
    eventType: "account_login_password",
    userId: data.user.id,
  });

  const role = await loadRoleSnapshot(supabase, data.user.id);

  // Phase 3 (T-081 PR-A) : event distinct admin_login pour détection
  // forensique de compromission (security-critical). Loggé EN PLUS de
  // account_login_password (asymétrie volontaire : un admin compromis
  // déclenche les 2 events ; un détecteur peut grep `admin_login` seul).
  if (role.isAdmin) {
    await logAuthEvent({
      eventType: "admin_login",
      userId: data.user.id,
      metadata: { source: "password" },
    });
  }

  const host = headers().get("host") ?? "";

  // T-321 — Cache role lookup post-login : pré-pose le cookie role snapshot
  // signé HMAC pour que la prochaine request middleware skip 2 queries DB
  // (users.roles + admin_users). Le cookie est bind sur user.id pour
  // invalider naturellement quand un autre user se connecte.
  // Async (Web Crypto API) car middleware Edge Runtime ne supporte pas
  // crypto Node natif.
  await setRoleSnapshotOnStore(cookies(), host, {
    user_id: data.user.id,
    roles: role.roles,
    isAdmin: role.isAdmin,
  });

  // Invalide le cache RSC du root layout AVANT redirect : sans ça, Next 14
  // navigue côté client vers la cible (ex: /compte) en réutilisant le
  // RootLayout déjà rendu pré-login (avec initial.user=null). Résultat
  // observé : navbar affiche "Connexion" alors que la session est OK
  // (sidebar /compte affiche le user). F5 ne corrige pas (cache RSC client
  // persiste), seul Ctrl+F5 forçait la re-évaluation SSR.
  // revalidatePath("/", "layout") force la ré-exécution de getInitialUserPayload()
  // sur la nouvelle navigation, avec les cookies auth fraîchement posés
  // par signInWithPassword.
  revalidatePath("/", "layout");
  // redirectTo posé par le middleware quand un user anonyme a tapé une route
  // protégée (cf. middleware.ts §2). Fallback canonique si absent/invalide.
  redirect(resolvePostLoginPath(role, host, formData.get("redirectTo")));
}

// =============================================================================
// Magic link — alternative au login mdp. Le redirectTo est routé en fonction
// du type d'user détecté (admin vs autres) via getAuthCallbackUrl pour que le
// callback tombe sur le bon subdomain et pose les cookies isolés appropriés
// (Chantier 4) :
//   admin → https://admin.terroir-local.fr/auth/callback
//   autres → https://www.terroir-local.fr/auth/callback (cookies partagés
//           avec pro via .terroir-local.fr, donc producers OK)
//
// Enumeration-resistant : même réponse UI quel que soit le résultat (email
// inexistant ou non — Supabase signInWithOtp avec shouldCreateUser=false
// échoue silencieusement, on ignore l'erreur et on renvoie le même success).
// =============================================================================

const magicLinkSchema = z.object({
  email: z.string().trim().email("Email invalide"),
});

export type MagicLinkState = { error?: string; message?: string };

export async function requestMagicLinkAction(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Email invalide" };
  }

  const email = parsed.data.email;

  // Lookup admin via la colonne email présente directement sur admin_users
  // (créée en 20260421100000). service_role bypass RLS — on ne révèle jamais
  // au client si l'email est admin ou pas, le check sert uniquement à router
  // le redirectTo.
  let isAdmin = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    isAdmin = !!adminRow;
  } catch (err) {
    // Fail-open : si le lookup échoue (DB down, etc.), on route sur le
    // callback par défaut. Un admin pourra retenter ou passer par le mdp.
    console.warn(
      `MAGIC_LINK_ADMIN_LOOKUP_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  // redirectTo posé par le middleware (cf. loginAction) : NE PAS le concaténer
  // à emailRedirectTo. Le template Supabase magic link utilise
  // `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (flow OTP
  // direct sans cookie code_verifier — fix bug PKCE cross-subdomain admin),
  // et un second `?` dans RedirectTo casserait l'URL. À la place, on persiste
  // le redirectTo dans un cookie HttpOnly (.terroir-local.fr en prod) lu par
  // /auth/callback après verifyOtp.
  setRedirectAfterAuth(formData.get("redirectTo"));

  const emailRedirectTo = getAuthCallbackUrl(isAdmin);

  // signInWithOtp avec shouldCreateUser=false : si l'email n'existe pas dans
  // auth.users, Supabase renvoie une erreur — on la swallow pour préserver
  // l'enumeration-resistance côté UI.
  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });
  } catch (err) {
    console.warn(
      `MAGIC_LINK_SEND_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  // Audit logué systématiquement (succès apparent ou pas) pour préserver
  // l'enumeration-resistance : un attaquant qui inspecte la table audit_logs
  // ne peut pas distinguer email valide vs invalide. metadata.email en clair
  // côté DB (pas un log applicatif Vercel) — cohérent avec la convention
  // notifications.metadata.email (cf. lib/rgpd/mask-email.ts).
  await logAuthEvent({
    eventType: "account_login_magic_link",
    userId: null,
    metadata: { email, isAdmin },
  });

  return {
    message:
      "Si cette adresse est connue, un lien vous a été envoyé. Consultez vos emails.",
  };
}

// =============================================================================
// Reset password (étape 1) — l'user saisit son email, Supabase envoie l'email
// avec lien recovery → étape 2 dans /reinitialiser-mot-de-passe.
//
// Server action (vs précédent appel client) pour 2 raisons :
//   1. Audit log côté serveur fiable (pas de bypass possible par client modifié).
//   2. Cohérence avec requestMagicLinkAction (même surface).
//
// redirectTo figé côté serveur via getPasswordResetUrl(isAdmin) — pas de
// dérivation depuis headers() Host/x-forwarded-proto. Raison T-317 : un
// reverse proxy mal configuré ou un cache poisoning permettrait à un
// attaquant d'injecter Host: evil.attacker.com et de capturer le token
// recovery via un mail pointant sur son domaine. URLs hardcodées dans
// lib/auth/email-redirect.ts (cf. AUTH_CALLBACK_*).
//
// Lookup admin via admin_users (mirror requestMagicLinkAction) pour préserver
// l'isolation Chantier 4 : un admin demandant reset depuis admin.* revient
// sur admin.*/reinitialiser-mot-de-passe (cookies admin isolés). Fail-open
// si lookup KO (DB down) → bascule sur le default www, l'admin pourra
// retenter.
//
// Enumeration-resistance : Supabase resetPasswordForEmail retourne success
// même pour email inexistant. On retourne toujours le même message ambigu,
// et on logue audit systématiquement (succès apparent ou pas).
// =============================================================================

const passwordResetSchema = z.object({
  email: z.string().trim().email("Email invalide"),
});

export type PasswordResetState = { error?: string; sent?: boolean };

export async function requestPasswordResetAction(
  _prev: PasswordResetState,
  formData: FormData,
): Promise<PasswordResetState> {
  const parsed = passwordResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Email invalide" };
  }

  const email = parsed.data.email;

  let isAdmin = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    isAdmin = !!adminRow;
  } catch (err) {
    console.warn(
      `PASSWORD_RESET_ADMIN_LOOKUP_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  const redirectTo = getPasswordResetUrl(isAdmin);

  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  } catch (err) {
    console.warn(
      `PASSWORD_RESET_SEND_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  await logAuthEvent({
    eventType: "password_reset_request",
    userId: null,
    metadata: { email },
  });

  return { sent: true };
}
