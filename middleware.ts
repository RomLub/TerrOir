import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookieConfigForHost } from "@/lib/supabase/cookie-domain";
import {
  readRoleSnapshotFromRequest,
  setRoleSnapshotOnResponse,
} from "@/lib/auth/role-snapshot-cookie";

const PRODUCER_HOST = "pro.terroir-local.fr";
const ADMIN_HOST = "admin.terroir-local.fr";
const CONSUMER_PROTECTED_PREFIX = "/compte";
const LOGIN_PATH = "/connexion";
const PRO_LANDING_PATH = "/pro-accueil";
const ADMIN_LANDING_PATH = "/admin-accueil";
const APEX = "terroir-local.fr";

// Chemins accessibles sans session, quel que soit le sous-domaine.
// /pro-accueil et /admin-accueil sont les cibles de rewrite des landings
// publiques servies sur pro.* et admin.* (cf. blocs spéciaux ci-dessous).
const PUBLIC_PATHS = new Set<string>([
  "/",
  "/connexion",
  "/invitation",
  "/auth/inscription",
  "/reinitialiser-mot-de-passe",
  "/mot-de-passe-oublie",
  "/desabonnement",
  PRO_LANDING_PATH,
  ADMIN_LANDING_PATH,
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

// T-321 — Cache role lookup. Lit le cookie role snapshot signé HMAC ; si
// valide ET bind sur le user.id courant → utilise le snapshot (skip 2 queries
// DB users.roles + admin_users). Sinon → DB lookup parallèle + flag pour
// que l'appelant écrive un nouveau cookie sur la réponse.
//
// Pourquoi pas écrire le cookie ici directement : le caller doit pouvoir
// mutate response (qui peut être réassigné par Supabase setAll callback).
// On retourne juste le besoin d'écrire ; le caller fait le set sur la
// réponse courante (cf. blocs admin/pro/needsAuth ci-dessous).
async function resolveRoleSnapshot(
  request: NextRequest,
  supabase: SupabaseClient,
  userId: string,
  host: string | undefined,
): Promise<{ roles: string[]; isAdmin: boolean; needsRefresh: boolean }> {
  const cached = readRoleSnapshotFromRequest(request, host);
  if (cached && cached.user_id === userId) {
    return {
      roles: cached.roles,
      isAdmin: cached.isAdmin,
      needsRefresh: false,
    };
  }
  const [{ data: profile }, { data: adminRow }] = await Promise.all([
    supabase.from("users").select("roles").eq("id", userId).maybeSingle(),
    supabase.from("admin_users").select("id").eq("id", userId).maybeSingle(),
  ]);
  const roles = (profile?.roles as string[] | undefined) ?? [];
  const isAdmin = !!adminRow;
  return { roles, isAdmin, needsRefresh: true };
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

  // Canonicalisation cross-subdomain : /pro-accueil et /admin-accueil ne
  // doivent répondre que sur leur sous-domaine respectif. Si on tape
  // www.terroir-local.fr/pro-accueil, on 301 vers https://pro.../ (la
  // landing y est servie via rewrite depuis "/"). Idem pour admin. On
  // limite aux hosts en .terroir-local.fr pour ne pas casser le dev local.
  const isTerroirHost = hostname === APEX || hostname.endsWith(`.${APEX}`);
  if (isTerroirHost && !isProducerHost && pathname === PRO_LANDING_PATH) {
    return NextResponse.redirect(`https://${PRODUCER_HOST}/`, 301);
  }
  if (isTerroirHost && !isAdminHost && pathname === ADMIN_LANDING_PATH) {
    return NextResponse.redirect(`https://${ADMIN_HOST}/`, 301);
  }

  // 0. Cas spécial admin.*/ : "/" est listé dans PUBLIC_PATHS (pour www/pro),
  //    mais sur admin.* on ne veut jamais servir la home publique consumer.
  //    Visiteur anonyme → rewrite vers la landing admin (mono-écran sobre).
  //    Utilisateur loggé → redirect /tableau-de-bord (admin) ou /connexion.
  if (isAdminHost && pathname === "/") {
    if (!user) {
      return NextResponse.rewrite(
        new URL(ADMIN_LANDING_PATH, request.url),
      );
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.search = "";

    // T-321 — Cache role snapshot : skip admin_users lookup si cookie hit.
    const snapshot = await resolveRoleSnapshot(
      request,
      supabase,
      user.id,
      host,
    );

    // Non-admin avec session sur admin.* : improbable depuis l'isolation
    // des cookies (Chantier 4), gardé en défensif → /connexion.
    redirectUrl.pathname = snapshot.isAdmin ? "/tableau-de-bord" : LOGIN_PATH;
    const redirectResponse = NextResponse.redirect(redirectUrl);
    if (snapshot.needsRefresh) {
      setRoleSnapshotOnResponse(redirectResponse, host, {
        user_id: user.id,
        roles: snapshot.roles,
        isAdmin: snapshot.isAdmin,
      });
    }
    return redirectResponse;
  }

  // 0b. Cas spécial pro.*/ : symétrique du bloc admin ci-dessus. "/" est dans
  //     PUBLIC_PATHS (pour www), donc pro.* tomberait sinon sur la home
  //     consumer. Visiteur anonyme → rewrite vers la landing pro (marketing
  //     "Devenir producteur"). Utilisateur loggé → routing par statut :
  //     draft → /onboarding, statuts actifs → /dashboard, deleted/no-row/
  //     non-producer → /connexion. Admin sur pro.* n'existe pas en session
  //     (isolation cookies Chantier 4 / 1d83f5d) → tombe dans le branch !user.
  if (isProducerHost && pathname === "/") {
    if (!user) {
      return NextResponse.rewrite(
        new URL(PRO_LANDING_PATH, request.url),
      );
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.search = "";

    // T-321 — Cache role snapshot : skip users.roles lookup si cookie hit.
    // (producers.statut reste DB ci-dessous : valeur volatile draft↔active.)
    const snapshot = await resolveRoleSnapshot(
      request,
      supabase,
      user.id,
      host,
    );
    const roles = snapshot.roles;

    if (!roles.includes("producer")) {
      redirectUrl.pathname = LOGIN_PATH;
      const redirectResponse = NextResponse.redirect(redirectUrl);
      if (snapshot.needsRefresh) {
        setRoleSnapshotOnResponse(redirectResponse, host, {
          user_id: user.id,
          roles: snapshot.roles,
          isAdmin: snapshot.isAdmin,
        });
      }
      return redirectResponse;
    }

    const { data: producerRow } = await supabase
      .from("producers")
      .select("statut")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!producerRow || producerRow.statut === "deleted") {
      redirectUrl.pathname = LOGIN_PATH;
      const redirectResponse = NextResponse.redirect(redirectUrl);
      if (snapshot.needsRefresh) {
        setRoleSnapshotOnResponse(redirectResponse, host, {
          user_id: user.id,
          roles: snapshot.roles,
          isAdmin: snapshot.isAdmin,
        });
      }
      return redirectResponse;
    }

    redirectUrl.pathname =
      producerRow.statut === "draft" ? "/onboarding" : "/dashboard";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    if (snapshot.needsRefresh) {
      setRoleSnapshotOnResponse(redirectResponse, host, {
        user_id: user.id,
        roles: snapshot.roles,
        isAdmin: snapshot.isAdmin,
      });
    }
    return redirectResponse;
  }

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
  // T-321 — Cache role snapshot : si cookie hit, skip les 2 queries DB
  // (gain ~50-100ms par request authentifiée). Sinon flag needsRefresh
  // pour écrire le cookie avant return.
  if (needsAuth && user) {
    const snapshot = await resolveRoleSnapshot(
      request,
      supabase,
      user.id,
      host,
    );
    const roles = snapshot.roles;
    const isAdmin = snapshot.isAdmin;

    // Refresh cookie sur la response courante : si on tombe dans le
    // fallthrough `return response` (cas nominal), le cookie est posé.
    // Pour les redirects ci-dessous on l'applique aussi sur la cible.
    if (snapshot.needsRefresh) {
      setRoleSnapshotOnResponse(response, host, {
        user_id: user.id,
        roles,
        isAdmin,
      });
    }

    // 3a. admin.terroir-local.fr : admin uniquement.
    if (isAdminHost && !isAdmin) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = LOGIN_PATH;
      const redirectResponse = NextResponse.redirect(redirectUrl);
      if (snapshot.needsRefresh) {
        setRoleSnapshotOnResponse(redirectResponse, host, {
          user_id: user.id,
          roles,
          isAdmin,
        });
      }
      return redirectResponse;
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
            const redirectResponse = NextResponse.redirect(redirectUrl);
            if (snapshot.needsRefresh) {
              setRoleSnapshotOnResponse(redirectResponse, host, {
                user_id: user.id,
                roles,
                isAdmin,
              });
            }
            return redirectResponse;
          }
          if (!isDraft && isOnboardingPath) {
            const redirectUrl = request.nextUrl.clone();
            redirectUrl.pathname = "/ma-page";
            redirectUrl.search = "";
            const redirectResponse = NextResponse.redirect(redirectUrl);
            if (snapshot.needsRefresh) {
              setRoleSnapshotOnResponse(redirectResponse, host, {
                user_id: user.id,
                roles,
                isAdmin,
              });
            }
            return redirectResponse;
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
