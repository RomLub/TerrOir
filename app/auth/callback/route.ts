import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookieConfigForHost } from "@/lib/supabase/cookie-domain";
import {
  canonicalPostLoginUrlWithRedirect,
  loadRoleSnapshot,
} from "@/lib/auth/post-login-redirect";
import {
  clearRedirectAfterAuth,
  readRedirectAfterAuth,
} from "@/lib/auth/redirect-cookie";
import { setRoleSnapshotOnResponse } from "@/lib/auth/role-snapshot-cookie";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { sanitizeNext } from "@/lib/auth/sanitize-next";

// Gère le retour des emails transactionnels Supabase (recovery, invite,
// magic link, signup) au format ?token_hash=…&type=… → OTP vérifié via
// verifyOtp.
// Paramètre optionnel ?next=/chemin/relatif pour personnaliser la destination
// (legacy — privilégier ?redirectTo).
// Paramètre optionnel ?redirectTo=/chemin/relatif propagé depuis le form
// magic link via emailRedirectTo : honoré sur le host canonique du rôle
// (consumer demandant /panier → www.*/panier ; producer demandant /commandes
// → pro.*/commandes). Path invalide ou absent → cible canonique du rôle.
// Pour type=recovery, la destination par défaut est /reinitialiser-mot-de-passe.
// Safety net pour emails recovery legacy en transit (template Supabase
// pré-5ff9394 pointait vers {{ .ConfirmationURL }} = /auth/callback).
// Le nouveau template pointe directement vers /reinitialiser-mot-de-passe
// avec token_hash, donc ce branchement n'est plus emprunté en flow nominal.
// Sans token_hash, la page affiche "Lien invalide" + CTA /mot-de-passe-oublie.
// Les cookies Supabase posés ici sont lus par le middleware dès la requête suivante.

const ALLOWED_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

type AuthErrorCode = "expired" | "invalid" | "missing" | "technical";

// Classifie une erreur Supabase verifyOtp (ou notre fallback "Missing
// token_hash") en code symbolique court FR-neutre. Évite de fuiter le
// message verbatim Supabase ("Token has expired" vs "Invalid token" vs
// "User already confirmed") dans la query string /connexion?reason=…, qui
// donnait à un attaquant une énumération sémantique des états du token
// (finding T-318 information disclosure). Le verbatim reste conservé côté
// logs Vercel via console.error AUTH_CALLBACK_ERROR pour debug forensique
// (pattern symétrique CHANGE_PASSWORD_UPDATE_USER_ERROR T-315).
function classifyAuthError(rawMessage: string | null): AuthErrorCode {
  if (!rawMessage) return "missing";
  const msg = rawMessage.toLowerCase();
  if (msg.includes("missing token_hash")) return "missing";
  if (msg.includes("expired")) return "expired";
  if (
    msg.includes("invalid") ||
    msg.includes("already confirmed") ||
    msg.includes("already used")
  ) {
    return "invalid";
  }
  return "technical";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type =
    rawType && ALLOWED_TYPES.includes(rawType as EmailOtpType)
      ? (rawType as EmailOtpType)
      : null;
  const next = sanitizeNext(url.searchParams.get("next"));
  // Deep-link post-auth : depuis la bascule au flow OTP token_hash, on ne
  // passe plus le redirectTo en query string sur l'emailRedirectTo (cf.
  // requestMagicLinkAction). Source primaire = cookie __Secure-redirect_after_auth
  // (ou redirect_after_auth legacy en dev / pendant la transition M-2 jusqu'au
  // 2026-05-12) posé au moment du form submit. Fallback ?redirectTo= conservé
  // pour les anciens emails encore en circulation pendant la fenêtre de bascule.
  const redirectTo =
    readRedirectAfterAuth(request) ?? url.searchParams.get("redirectTo");

  // setAll est appelé par Supabase après verifyOtp. On accumule
  // les cookies à poser dans un buffer pour pouvoir les attacher à la
  // réponse finale, peu importe la cible de redirect choisie ensuite.
  const cookiesToWrite: {
    name: string;
    value: string;
    options: CookieOptions;
  }[] = [];

  const host = request.headers.get("host") ?? undefined;
  const cookieOptions = cookieConfigForHost(host);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) => {
          cookiesToSet.forEach((c) => cookiesToWrite.push(c));
        },
      },
    },
  );

  let authError: string | null = null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) authError = error.message;
  } else {
    authError = "Missing token_hash";
  }

  if (authError) {
    const reasonCode = classifyAuthError(authError);
    // Verbatim Supabase conservé côté logs Vercel pour debug, JAMAIS exposé
    // dans la query string vers /connexion (anti info disclosure T-318).
    console.error(
      `AUTH_CALLBACK_ERROR type=${type ?? "null"} reason_code=${reasonCode} raw_message=${authError}`,
    );
    const failUrl = new URL("/connexion", url.origin);
    failUrl.searchParams.set("error", "auth_callback");
    failUrl.searchParams.set("reason", reasonCode);
    return NextResponse.redirect(failUrl);
  }

  // Audit log post-confirmation pour type=signup (T-300). Posé AVANT le
  // branching targetUrl car le flow signup utilise ?next=/compte/commandes
  // et n'emprunte donc pas la branche else où getUser() est déjà appelé
  // pour les autres flows. Pattern audit forensique : l'event reflète un
  // compte effectivement créé (post-confirm), pas une intention de signup
  // pending qui pourrait ne jamais être confirmée.
  if (type === "signup") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await logAuthEvent({
        eventType: "account_signup",
        userId: user.id,
        metadata: { source: "consumer_signup_form" },
      });
    }
  }

  // Cible : ?next= explicite > /reinitialiser-mot-de-passe (recovery) > routing
  // rôle-aware cross-domain via canonicalPostLoginUrlWithRedirect. Le rôle
  // dicte le host (admin/pro/www) ; le path est ?redirectTo= s'il est valide,
  // sinon la cible canonique du rôle. Le rôle est lu via le client Supabase
  // qui voit déjà la session fraîchement créée.
  // T-321 — Cache role snapshot pré-rempli post-OTP succès : la route a
  // déjà résolu loadRoleSnapshot, on en profite pour pré-poser le cookie
  // signé HMAC avant le redirect. La prochaine request middleware skip
  // les 2 queries DB users.roles + admin_users.
  let roleSnapshotToWrite: {
    user_id: string;
    roles: string[];
    isAdmin: boolean;
  } | null = null;

  let targetUrl: URL | string;
  if (next) {
    targetUrl = new URL(next, url.origin);
  } else if (type === "recovery") {
    targetUrl = new URL("/reinitialiser-mot-de-passe", url.origin);
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const role = await loadRoleSnapshot(supabase, user.id);
      roleSnapshotToWrite = {
        user_id: user.id,
        roles: role.roles,
        isAdmin: role.isAdmin,
      };

      // Phase 3 multi-events audit (T-081 PR-A) — events forensiques
      // additionnels sur le callback OTP. email_change : audit le swap
      // d'adresse (verifyOtp a mis à jour auth.users.email côté Supabase).
      // admin_login magiclink : pendant security-critical du admin_login
      // password déjà loggé dans loginAction (cf. app/connexion/actions.ts).
      if (type === "email_change") {
        // Sync public.users.email = auth.users.email après verifyOtp succès.
        // verifyOtp a déjà mis à jour auth.users.email côté Supabase ;
        // user.email reflète la nouvelle adresse confirmée. Sans cette sync,
        // public.users.email reste sur l'ancienne valeur (désynchro).
        // Fail-open : si l'UPDATE échoue (DB down, RLS, etc.), on log et on
        // poursuit — l'audit log et la session restent valides, la sync
        // pourra être réconciliée hors-bande.
        if (user.email) {
          const { error: syncError } = await supabase
            .from("users")
            .update({ email: user.email })
            .eq("id", user.id);
          if (syncError) {
            console.error(
              `EMAIL_CHANGE_SYNC_ERROR user_id=${user.id} message=${syncError.message}`,
            );
          }
        }
        await logAuthEvent({
          eventType: "email_change",
          userId: user.id,
          metadata: {
            new_email_masked: user.email ? maskEmail(user.email) : null,
          },
        });
      }
      if (type === "magiclink" && role.isAdmin) {
        await logAuthEvent({
          eventType: "admin_login",
          userId: user.id,
          metadata: { source: "magic_link" },
        });
      }

      targetUrl = canonicalPostLoginUrlWithRedirect(role, redirectTo);
    } else {
      targetUrl = new URL("/", url.origin);
    }
  }

  // Bypass cache RSC du root layout pour signup : l'utilisateur transite
  // de "non connecté pré-confirmation" à "connecté post-confirmation" —
  // la navbar du RootLayout doit lire la session fresh dès la requête
  // suivant le redirect. Pattern strictement identique au fix signup
  // Server Action PR #17 (avant bascule confirmation T-300).
  if (type === "signup") {
    revalidatePath("/", "layout");
  }

  const response = NextResponse.redirect(targetUrl);
  cookiesToWrite.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  // Cookie deep-link consommé : on l'expire systématiquement (même quand il
  // n'a pas été utilisé, ex. flow recovery où on force /reinitialiser-mot-de-passe).
  // Évite qu'un redirectTo périmé persiste pour la session suivante.
  clearRedirectAfterAuth(response, host);
  // T-321 — Pose le cookie role snapshot signé HMAC sur la réponse de redirect
  // (cross-domain via canonicalPostLoginUrl, donc le cookie doit être sur le
  // host courant pour être lisible par middleware au prochain hit).
  // Async (Web Crypto API) car middleware Edge Runtime ne supporte pas
  // crypto Node natif.
  if (roleSnapshotToWrite) {
    await setRoleSnapshotOnResponse(response, host, roleSnapshotToWrite);
  }
  return response;
}
