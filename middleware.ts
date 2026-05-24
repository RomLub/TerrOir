import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookieConfigForHost } from "@/lib/supabase/cookie-domain";
import {
  readRoleSnapshotFromRequest,
  setRoleSnapshotOnResponse,
  ROLE_SNAPSHOT_TTL_SECONDS,
} from "@/lib/auth/role-snapshot-cookie";

const PRODUCER_HOST = "pro.terroir-local.fr";
const ADMIN_HOST = "admin.terroir-local.fr";
const WWW_HOST = "www.terroir-local.fr";
const CONSUMER_PROTECTED_PREFIX = "/compte";
const LOGIN_PATH = "/connexion";
const PRO_LANDING_PATH = "/pro-accueil";
const ADMIN_LANDING_PATH = "/admin-accueil";
const APEX = "terroir-local.fr";

// F-005a (audit P0-TC 2026-05-10) — CSP nonce-based en mode Report-Only.
// Génère un nonce crypto fort par requête, le pose dans le header de
// requête (lu par Next.js pour l'injecter dans ses scripts internes RSC
// + hydratation, et par app/layout.tsx pour usage futur) et dans le
// header de réponse Content-Security-Policy-Report-Only (le browser
// collecte les violations sans bloquer la prod). Bascule en mode
// enforce différée (~24-48 h d'observation preview) cf.
// docs/conventions/security-headers.md.
//
// Pourquoi ici plutôt que dans next.config.js : nonce dynamique par
// requête nécessite runtime serveur (Edge), incompatible avec les
// headers statiques de next.config.js. La CSP enforce statique
// (unsafe-inline + unsafe-eval) a été retirée de next.config.js dans
// le même commit pour éviter la double CSP qui rendrait le nonce
// inutile (intersection des permissions browser).
function generateCspNonce(): string {
  // Edge runtime : Web Crypto API. 16 octets = 128 bits, recommandation
  // W3C minimum pour non-prédictibilité d'un nonce CSP.
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

function buildCspReportOnly(nonce: string): string {
  // Construction dynamique : on lit NEXT_PUBLIC_SUPABASE_URL pour
  // whitelister précisément le projet Supabase TerrOir au lieu d'un
  // wildcard *.supabase.co trop large. Fallback wildcard si l'env var
  // est absente (build local sans .env.local).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let supabaseHttps = "https://*.supabase.co";
  let supabaseWss = "wss://*.supabase.co";
  if (supabaseUrl) {
    try {
      const u = new URL(supabaseUrl);
      supabaseHttps = `https://${u.host}`;
      supabaseWss = `wss://${u.host}`;
    } catch {
      // URL invalide → on garde le fallback wildcard.
    }
  }
  // 'strict-dynamic' : permet aux scripts noncés de loader d'autres
  // scripts dynamiquement sans avoir à tous les whitelister. Combine
  // avec 'nonce-XXX' pour un script-src moderne. js.stripe.com +
  // m.stripe.network restent whitelistés explicitement (Stripe.js
  // peut être chargé hors bootstrap noncé). va.vercel-scripts.com
  // pour Vercel Analytics. blob: pour workers Mapbox.
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://m.stripe.network https://va.vercel-scripts.com blob:`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://api.stripe.com https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://va.vercel-scripts.com https://vitals.vercel-analytics.com ${supabaseHttps} ${supabaseWss}`,
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://m.stripe.network",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

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
  const cached = await readRoleSnapshotFromRequest(request, host);
  if (cached && cached.user_id === userId) {
    // F-026 (audit P0 sweep 2026-05-11) : staleness check serveur. Le cookie
    // est valide HMAC + non expiré + bind user_id, mais on consulte la table
    // role_snapshot_revocations pour invalider les snapshots émis avant un
    // changement de rôle ou de status admin. issued_at = expires_at - TTL
    // (le cookie ne porte pas issued_at en propre, calcul dérivé).
    const issuedAtMs =
      cached.expires_at - ROLE_SNAPSHOT_TTL_SECONDS * 1000;
    // Lookup via RPC SECDEF (le middleware utilise un client anon Supabase,
    // pas service_role) — la RPC fait juste le SELECT min_issued_at par
    // user_id. Fail-open : si la RPC throw / renvoie une erreur, on garde
    // le snapshot cached (le pire est une staleness de 15min, statu quo
    // pré-F-026 acceptable comme dégradation).
    try {
      const { data: minIssuedAtIso } = await supabase.rpc(
        "get_role_snapshot_revocation",
        { p_user_id: userId },
      );
      if (typeof minIssuedAtIso === "string") {
        const minIssuedAtMs = new Date(minIssuedAtIso).getTime();
        if (Number.isFinite(minIssuedAtMs) && issuedAtMs < minIssuedAtMs) {
          // Snapshot stale → force DB lookup + needsRefresh pour réécrire
          // le cookie avec roles/isAdmin frais.
          // (Tomber dans le path DB ci-dessous.)
        } else {
          return {
            roles: cached.roles,
            isAdmin: cached.isAdmin,
            needsRefresh: false,
          };
        }
      } else {
        // Pas de révocation enregistrée pour ce user → snapshot frais.
        return {
          roles: cached.roles,
          isAdmin: cached.isAdmin,
          needsRefresh: false,
        };
      }
    } catch (e) {
      // Fail-open : on garde le snapshot cached (dégradation acceptable).
      console.warn(
        `[ROLE_SNAPSHOT_REVOCATION_RPC_WARN] user=${userId} error=${(e as Error).message}`,
      );
      return {
        roles: cached.roles,
        isAdmin: cached.isAdmin,
        needsRefresh: false,
      };
    }
  }
  const [{ data: profile }, { data: adminRow }] = await Promise.all([
    supabase.from("users").select("roles").eq("id", userId).maybeSingle(),
    // Chantier 6 : un admin suspendu (suspended_at non null) n'est plus admin.
    // La suspension révoque aussi le snapshot caché (trigger UPDATE OF
    // suspended_at) → ce lookup live re-dérive isAdmin=false au hit suivant.
    supabase
      .from("admin_users")
      .select("id, suspended_at")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const roles = (profile?.roles as string[] | undefined) ?? [];
  const isAdmin =
    !!adminRow &&
    (adminRow as { suspended_at: string | null }).suspended_at == null;
  return { roles, isAdmin, needsRefresh: true };
}

export async function middleware(request: NextRequest) {
  // F-005a : nonce CSP Report-Only injecté en tête de requête. Le
  // header `Content-Security-Policy` est posé sur les request headers
  // (pas Report-Only) pour que Next.js l'injecte automatiquement dans
  // ses scripts internes RSC + hydratation. Le `x-nonce` est consommé
  // par app/layout.tsx pour usage futur (composants custom qui en
  // auraient besoin).
  const nonce = generateCspNonce();
  const cspHeader = buildCspReportOnly(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy-Report-Only", cspHeader);

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
            request: { headers: requestHeaders },
          });
          response.headers.set(
            "Content-Security-Policy-Report-Only",
            cspHeader,
          );
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

  // Isolation rôles/sous-domaine (fix middleware-subdomain-isolation) :
  // `/compte/*` est une route CONSUMER par nature → jamais servie sur pro.*.
  // On redirige en ABSOLU vers www.* (préserve sous-chemin + query). Vaut pour
  // TOUS les utilisateurs, y compris les producteurs (un producteur gère sa
  // fiche sur pro.*, son compte consumer sur www.*) et les non-connectés
  // (www.* gérera l'auth). Redirect absolu obligatoire : un redirect relatif
  // resterait sur pro.* → boucle. Borné en dev (isProducerHost faux hors
  // hostname prod), donc sans effet sur localhost.
  if (isProducerHost && pathname.startsWith(CONSUMER_PROTECTED_PREFIX)) {
    return NextResponse.redirect(
      new URL(`${pathname}${request.nextUrl.search}`, `https://${WWW_HOST}`),
    );
  }

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
      await setRoleSnapshotOnResponse(redirectResponse, host, {
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
        await setRoleSnapshotOnResponse(redirectResponse, host, {
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
        await setRoleSnapshotOnResponse(redirectResponse, host, {
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
      await setRoleSnapshotOnResponse(redirectResponse, host, {
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
      await setRoleSnapshotOnResponse(response, host, {
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
        await setRoleSnapshotOnResponse(redirectResponse, host, {
          user_id: user.id,
          roles,
          isAdmin,
        });
      }
      return redirectResponse;
    }

    // 3a-bis. Isolation : utilisateur connecté SANS rôle producer (et non-admin)
    //     sur pro.* → renvoyé vers l'espace consumer www.*. La racine pro.*
    //     est déjà gérée plus haut (bloc 0b → /connexion) et /compte/* aussi
    //     (redirect www.* avant l'auth) ; ce bloc couvre les AUTRES chemins
    //     producteur tentés par un non-producteur. Redirect ABSOLU vers la
    //     racine www.* (home consumer, dans PUBLIC_PATHS → pas de re-redirect,
    //     donc pas de boucle).
    if (isProducerHost && !isAdmin && !roles.includes("producer")) {
      const redirectResponse = NextResponse.redirect(
        new URL("/", `https://${WWW_HOST}`),
      );
      if (snapshot.needsRefresh) {
        await setRoleSnapshotOnResponse(redirectResponse, host, {
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
              await setRoleSnapshotOnResponse(redirectResponse, host, {
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
              await setRoleSnapshotOnResponse(redirectResponse, host, {
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
