import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { sharedCookieOptions } from "@/lib/supabase/cookie-options";

const PRODUCER_HOST = "pro.terroir-local.fr";
const ADMIN_HOST = "admin.terroir-local.fr";
const CONSUMER_PROTECTED_PREFIX = "/compte";
const LOGIN_PATH = "/connexion";

// Chemins accessibles sans session, quel que soit le sous-domaine.
const PUBLIC_PATHS = new Set<string>([
  "/",
  "/connexion",
  "/inscription",
  "/invitation",
  "/auth/inscription",
  "/reset-password",
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

  // 3. Rôle nécessaire : lookup parallèle sur users + admin_users.
  //    Les deux tables sont mutuellement exclusives (trigger DB), donc au
  //    plus l'une des deux renvoie une ligne.
  if (needsAuth && user) {
    const [{ data: profile }, { data: adminRow }] = await Promise.all([
      supabase.from("users").select("roles").eq("id", user.id).maybeSingle(),
      supabase
        .from("admin_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle(),
    ]);
    const roles = (profile?.roles as string[] | undefined) ?? [];
    const isAdmin = !!adminRow;

    // 3a. admin.terroir-local.fr : admin uniquement.
    if (isAdminHost && !isAdmin) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = LOGIN_PATH;
      return NextResponse.redirect(redirectUrl);
    }

    // 3b. /compte accédé par un producteur → redirige vers pro.terroir-local.fr.
    //     (Chantier 5 assouplira ce comportement pour laisser les producteurs
    //      utiliser leur double casquette consumer+producer.)
    if (isConsumerProtected && roles.includes("producer")) {
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
