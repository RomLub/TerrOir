import { NextResponse, type NextRequest } from "next/server";
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
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";

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

function sanitizeNext(raw: string | null): string | null {
  if (!raw) return null;
  // On n'autorise qu'un chemin relatif sur le même host — jamais une URL externe.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
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
  // requestMagicLinkAction). Source primaire = cookie redirect_after_auth
  // posé au moment du form submit. Fallback ?redirectTo= conservé pour les
  // anciens emails encore en circulation pendant la fenêtre de bascule.
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
    const failUrl = new URL("/connexion", url.origin);
    failUrl.searchParams.set("error", "auth_callback");
    failUrl.searchParams.set("reason", authError.slice(0, 120));
    return NextResponse.redirect(failUrl);
  }

  // Cible : ?next= explicite > /reinitialiser-mot-de-passe (recovery) > routing
  // rôle-aware cross-domain via canonicalPostLoginUrlWithRedirect. Le rôle
  // dicte le host (admin/pro/www) ; le path est ?redirectTo= s'il est valide,
  // sinon la cible canonique du rôle. Le rôle est lu via le client Supabase
  // qui voit déjà la session fraîchement créée.
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

      // Phase 3 multi-events audit (T-081 PR-A) — events forensiques
      // additionnels sur le callback OTP. email_change : audit le swap
      // d'adresse (verifyOtp a mis à jour auth.users.email côté Supabase).
      // admin_login magiclink : pendant security-critical du admin_login
      // password déjà loggé dans loginAction (cf. app/connexion/actions.ts).
      if (type === "email_change") {
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

  const response = NextResponse.redirect(targetUrl);
  cookiesToWrite.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  // Cookie deep-link consommé : on l'expire systématiquement (même quand il
  // n'a pas été utilisé, ex. flow recovery où on force /reinitialiser-mot-de-passe).
  // Évite qu'un redirectTo périmé persiste pour la session suivante.
  clearRedirectAfterAuth(response, host);
  return response;
}
