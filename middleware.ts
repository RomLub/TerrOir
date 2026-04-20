import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const PRODUCER_HOST = "pro.terroir.fr";
const ADMIN_HOST = "admin.terroir.fr";
const CONSUMER_PROTECTED_PREFIX = "/compte";
const LOGIN_PATH = "/connexion";

// Chemins accessibles sans session, quel que soit le sous-domaine.
const PUBLIC_PATHS = new Set<string>([
  "/",
  "/connexion",
  "/inscription",
  "/invitation",
  "/auth/inscription",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Tolère les chemins imbriqués des flux publics (ex: /auth/inscription/xxx)
  return (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/invitation/") ||
    pathname.startsWith("/api/public/")
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) => {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { hostname, pathname } = request.nextUrl;

  const isProducerHost = hostname === PRODUCER_HOST;
  const isAdminHost = hostname === ADMIN_HOST;
  const isConsumerProtected =
    !isProducerHost &&
    !isAdminHost &&
    pathname.startsWith(CONSUMER_PROTECTED_PREFIX);

  const needsAuth = isProducerHost || isAdminHost || isConsumerProtected;

  // 1. Chemins publics : pas de redirection.
  if (isPublicPath(pathname)) {
    return response;
  }

  // 2. Route protégée sans session → /connexion.
  if (needsAuth && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = LOGIN_PATH;
    redirectUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // 3. Rôle nécessaire : lookup unique en DB.
  if (needsAuth && user) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = profile?.role as "consumer" | "producer" | "admin" | undefined;

    // 3a. admin.terroir.fr : admin uniquement.
    if (isAdminHost && role !== "admin") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = LOGIN_PATH;
      return NextResponse.redirect(redirectUrl);
    }

    // 3b. /compte accédé par un producteur → redirige vers pro.terroir.fr.
    if (isConsumerProtected && role === "producer") {
      const producerBase =
        process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://pro.localhost:3000";
      return NextResponse.redirect(new URL("/", producerBase));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
