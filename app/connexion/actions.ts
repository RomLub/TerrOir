"use server";

import { z } from "zod";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import { loginSchema } from "@/lib/auth/validators";
import { maskEmail } from "@/lib/rgpd/mask-email";
import {
  extractRequestContext,
  logAuthEvent,
} from "@/lib/audit-logs/log-auth-event";
import {
  consumeRateLimit,
  getLoginRateLimit,
  getMagicLinkRateLimit,
  getRecoveryRateLimit,
} from "@/lib/rate-limit";
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

  // T-305 PR-B : rate-limit applicatif IP avant signInWithPassword. Cap 5/60s
  // (cf. lib/rate-limit.ts getLoginRateLimit). Defensive layer applicative
  // distincte du cap rate-limited Supabase (cf. T-309 reason_code). Mutualisé
  // avec requestMagicLinkAction (D2 PR-B) — un attaquant qui alterne login
  // mdp + magic link sur la même IP rencontre le compteur partagé.
  const { ipAddress } = extractRequestContext(await headers());
  const rateLimit = await consumeRateLimit(
    getLoginRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rateLimit.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: {
        route: "login",
        cap: rateLimit.limit,
        reset: rateLimit.reset,
      },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    // Audit forensique : on logue chaque tentative échouée pour permettre
    // détection brute-force / énumération. email_masked en metadata audit
    // (audit Auth 2026-05-05 H-3 : alignement masking partout, y compris
    // user pas authentifié). reason_code catégoriel évite la dépendance
    // directe aux codes Supabase verbatim côté analytics. logAuthEvent est
    // fail-safe (swallow + warn) — un échec d'écriture audit ne bloque pas
    // le retour d'erreur UI.
    await logAuthEvent({
      eventType: "login_failed",
      userId: null,
      metadata: {
        email_masked: maskEmail(parsed.data.email),
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

  const host = (await headers()).get("host") ?? "";

  // T-321 — Cache role lookup post-login : pré-pose le cookie role snapshot
  // signé HMAC pour que la prochaine request middleware skip 2 queries DB
  // (users.roles + admin_users). Le cookie est bind sur user.id pour
  // invalider naturellement quand un autre user se connecte.
  // Async (Web Crypto API) car middleware Edge Runtime ne supporte pas
  // crypto Node natif.
  await setRoleSnapshotOnStore(await cookies(), host, {
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

  // SSO admin (une seule saisie de mot de passe). Un admin qui se connecte sur
  // www/pro (cookie partagé .terroir-local.fr) ne peut PAS transmettre sa
  // session à admin.* (cookie isolé, par design Chantier 4) → sinon 2e login.
  // Plutôt que de re-demander le mdp, on génère un jeton magic-link à usage
  // unique pour SA PROPRE adresse (déjà vérifiée par le mdp ci-dessus) et on
  // redirige vers le callback admin.* (qui pose le cookie isolé via
  // cookieConfigForHost). Réutilise le mécanisme Chantier 1, sans email.
  // Niveau de sécu = identique à un login mdp direct sur admin.* (jeton usage
  // unique, courte durée, adresse de la session). Gate sur les hosts PROD
  // www/pro (en dev/preview, pas d'isolation cookie → login unique natif).
  // Fail-safe : si generateLink échoue → redirect normal (2 logins, OK).
  let adminHandoffUrl: string | null = null;
  if (
    role.isAdmin &&
    data.user.email &&
    (host === "www.terroir-local.fr" || host === "pro.terroir-local.fr")
  ) {
    try {
      const adminClient = createSupabaseAdminClient();
      const { data: link, error: linkErr } =
        await adminClient.auth.admin.generateLink({
          type: "magiclink",
          email: data.user.email,
        });
      const tokenHash = link?.properties?.hashed_token;
      if (!linkErr && tokenHash) {
        adminHandoffUrl = `${getAuthCallbackUrl(true)}?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink`;
      } else if (linkErr) {
        console.warn(
          `ADMIN_SSO_HANDOFF_WARN user_id=${data.user.id} error=${linkErr.message}`,
        );
      }
    } catch (err) {
      console.warn(
        `ADMIN_SSO_HANDOFF_WARN user_id=${data.user.id} error=${(err as Error).message}`,
      );
    }
  }
  // redirect() throw NEXT_REDIRECT → appelé HORS du try/catch pour ne pas l'avaler.
  if (adminHandoffUrl) redirect(adminHandoffUrl);

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

  // Audit Auth 2026-05-05 M-5 : rate-limit magic link séparé de login
  // (3/120s vs 5/60s pour login). Évite qu'un attaquant flood magic link
  // consomme le quota login pour tous les users derrière une IP NAT.
  const { ipAddress } = extractRequestContext(await headers());
  const rateLimit = await consumeRateLimit(
    getMagicLinkRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rateLimit.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: {
        route: "magic_link",
        cap: rateLimit.limit,
        reset: rateLimit.reset,
      },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
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
      .ilike("email", escapeIlikeEmail(email))
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
  await setRedirectAfterAuth(formData.get("redirectTo"));

  const emailRedirectTo = getAuthCallbackUrl(isAdmin);

  // signInWithOtp avec shouldCreateUser=false : si l'email n'existe pas dans
  // auth.users, Supabase renvoie une erreur — on la swallow pour préserver
  // l'enumeration-resistance côté UI.
  try {
    const supabase = await createSupabaseServerClient();
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
  // ne peut pas distinguer email valide vs invalide. email_masked en
  // metadata (audit Auth 2026-05-05 H-3 : alignement masking partout).
  await logAuthEvent({
    eventType: "account_login_magic_link",
    userId: null,
    metadata: { email_masked: maskEmail(email), isAdmin },
  });

  return {
    message:
      "Si cette adresse est connue, un lien vous a été envoyé. Consultez vos emails.",
  };
}

// =============================================================================
// Chantier 1 — Accès admin en un clic depuis www. Un admin connecté sur www
// (cookie partagé .terroir-local.fr) ne peut PAS partager sa session avec
// admin.* (cookie isolé sb-admin-auth-token, par design Chantier 4). Le pont
// sécurisé = un magic link auto : on envoie à SA PROPRE adresse (session) un
// lien dont le callback tombe sur admin.* et y pose le cookie admin isolé.
//
// Session-based (≠ requestMagicLinkAction qui prend un email en input) :
//   - l'email cible = celui de la session (jamais arbitraire),
//   - réservé aux admins (vérif serveur isAdmin via getSessionUser → lookup
//     admin_users), refus générique sinon (le bouton est déjà admin-only UI).
// Aucune migration, aucun partage de cookie cross-subdomain : on réutilise
// signInWithOtp + le callback existant (qui pose sb-admin-auth-token sur
// admin.* via cookieConfigForHost).
// =============================================================================

export async function requestAdminMagicLinkAction(
  _prev: MagicLinkState,
  _formData: FormData,
): Promise<MagicLinkState> {
  const session = await getSessionUser();
  // Refus générique : ni l'existence d'un compte ni le statut admin ne fuit.
  if (!session?.isAdmin || !session.email) {
    return { error: "Accès non autorisé." };
  }

  // Rate-limit mutualisé avec le magic link classique (même surface d'envoi).
  const { ipAddress } = extractRequestContext(await headers());
  const rateLimit = await consumeRateLimit(
    getMagicLinkRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rateLimit.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: session.id,
      metadata: {
        route: "admin_magic_link",
        cap: rateLimit.limit,
        reset: rateLimit.reset,
      },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  // emailRedirectTo = callback admin.* → le callback pose sb-admin-auth-token
  // (isolé) et route vers /tableau-de-bord (canonique du rôle admin). Pas de
  // setRedirectAfterAuth nécessaire : la destination admin par défaut suffit.
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signInWithOtp({
      email: session.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: getAuthCallbackUrl(true),
      },
    });
  } catch (err) {
    console.warn(
      `ADMIN_MAGIC_LINK_SEND_WARN user_id=${session.id} error=${(err as Error).message}`,
    );
  }

  await logAuthEvent({
    eventType: "account_login_magic_link",
    userId: session.id,
    metadata: { email_masked: maskEmail(session.email), source: "admin_button" },
  });

  return {
    message: "Lien d'accès admin envoyé à votre adresse. Consultez vos emails.",
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

  // T-305 PR-B : rate-limit applicatif IP avant resetPasswordForEmail. Cap
  // 3/60s (plus strict que login : recovery déclenche envoi mail coûteux +
  // flooding boîte cible). Helper dédié getRecoveryRateLimit (cf. lib/rate-
  // limit.ts).
  const { ipAddress } = extractRequestContext(await headers());
  const rateLimit = await consumeRateLimit(
    getRecoveryRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rateLimit.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: {
        route: "recovery",
        cap: rateLimit.limit,
        reset: rateLimit.reset,
      },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const email = parsed.data.email;

  let isAdmin = false;
  try {
    const admin = createSupabaseAdminClient();
    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .ilike("email", escapeIlikeEmail(email))
      .maybeSingle();
    isAdmin = !!adminRow;
  } catch (err) {
    console.warn(
      `PASSWORD_RESET_ADMIN_LOOKUP_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  const redirectTo = getPasswordResetUrl(isAdmin);

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  } catch (err) {
    console.warn(
      `PASSWORD_RESET_SEND_WARN email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  await logAuthEvent({
    eventType: "password_reset_request",
    userId: null,
    metadata: { email_masked: maskEmail(email) },
  });

  return { sent: true };
}
