import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sharedCookieOptions } from "@/lib/supabase/cookie-options";

// Gère le retour des emails transactionnels Supabase (recovery, invite,
// magic link, signup). Deux formats supportés :
//   - ?code=…        → PKCE, échangé contre une session cookie
//   - ?token_hash=…&type=…  → OTP vérifié via verifyOtp
// Paramètre optionnel ?next=/chemin/relatif pour personnaliser la destination.
// Pour type=recovery, la destination par défaut est /reset-password.
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
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type =
    rawType && ALLOWED_TYPES.includes(rawType as EmailOtpType)
      ? (rawType as EmailOtpType)
      : null;
  const next = sanitizeNext(url.searchParams.get("next"));

  const defaultPath = type === "recovery" ? "/reset-password" : "/";
  const targetUrl = new URL(next ?? defaultPath, url.origin);
  const response = NextResponse.redirect(targetUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sharedCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  let authError: string | null = null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) authError = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (error) authError = error.message;
  } else {
    authError = "Missing code or token_hash";
  }

  if (authError) {
    const failUrl = new URL("/connexion", url.origin);
    failUrl.searchParams.set("error", "auth_callback");
    failUrl.searchParams.set("reason", authError.slice(0, 120));
    return NextResponse.redirect(failUrl);
  }

  return response;
}
