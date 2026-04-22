import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookieConfigForHost } from "@/lib/supabase/cookie-domain";

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

    // 3b. Producer avec statut='draft' sur pro.* : redirige vers /onboarding
    //     (Chantier 2 Phase 4). Exemptions : /onboarding lui-même et
    //     /invitation/* pour éviter toute boucle. Admins bypass complet.
    //     Inversement, si l'utilisateur atterrit sur /onboarding sans draft
    //     à reprendre, on le renvoie vers /ma-page.
    if (isProducerHost && !isAdmin && roles.includes("producer")) {
      const isOnboardingPath = pathname === "/onboarding";
      const isInvitationPath = pathname.startsWith("/invitation");

      if (!isInvitationPath) {
        const { data: producerRow, error: producerError } = await supabase
          .from("producers")
          .select("statut")
          .eq("user_id", user.id)
          .maybeSingle();

        // Fail-open : si la query plante (soucis transient, RLS inattendue),
        // on laisse passer plutôt que de bloquer un producteur légitime.
        if (!producerError) {
          const isDraft = producerRow?.statut === "draft";
          if (isDraft && !isOnboardingPath) {
            const redirectUrl = request.nextUrl.clone();
            redirectUrl.pathname = "/onboarding";
            redirectUrl.search = "";
            return NextResponse.redirect(redirectUrl);
          }
          if (!isDraft && isOnboardingPath) {
            const redirectUrl = request.nextUrl.clone();
            redirectUrl.pathname = "/ma-page";
            redirectUrl.search = "";
            return NextResponse.redirect(redirectUrl);
          }
        }
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
