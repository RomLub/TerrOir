import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Secret figé pour signatures déterministes des cookies de test.
const TEST_SECRET = "c".repeat(64);
const ORIGINAL_SECRET = process.env.ROLE_SNAPSHOT_SECRET;
const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Mocks @supabase/ssr injectés via vi.mock factory (hoisting). On expose
// des hooks mutables pour customiser par test.
// Perf (Lot A) : le middleware vérifie la session via auth.getClaims() (et non
// plus getUser()). On mocke getClaims avec sa vraie shape :
//   { data: { claims: { sub, email } }, error } | { data: null, error }
// Les helpers claimsResult(id) / noClaimsResult() (plus bas) produisent ces
// deux variantes.
const mockGetClaims = vi.fn();
const mockUsersRolesMaybeSingle = vi.fn();
const mockAdminUsersMaybeSingle = vi.fn();
const mockProducersMaybeSingle = vi.fn();
// F-026 : RPC get_role_snapshot_revocation → retourne ISO string ou null.
const mockRpcGetRevocation = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: () => mockGetClaims(),
    },
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockUsersRolesMaybeSingle(),
            }),
          }),
        };
      }
      if (table === "admin_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockAdminUsersMaybeSingle(),
            }),
          }),
        };
      }
      if (table === "producers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockProducersMaybeSingle(),
            }),
          }),
        };
      }
      throw new Error(`Unmocked table: ${table}`);
    },
    rpc: (name: string, args: unknown) => mockRpcGetRevocation(name, args),
  }),
}));

import {
  signRoleSnapshot,
  parseAndVerifyRoleSnapshot,
} from "@/lib/auth/role-snapshot-cookie";

// Helpers de lisibilité pour produire la shape de retour de getClaims().
// Session valide → data.claims.sub = id (claims.email optionnel).
function claimsResult(userId: string, email?: string) {
  return { data: { claims: { sub: userId, email } }, error: null };
}
// Pas de session (anonyme / JWT invalide) → data = null (fail-closed).
function noClaimsResult() {
  return { data: null, error: null };
}

beforeEach(() => {
  process.env.ROLE_SNAPSHOT_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  mockGetClaims.mockReset();
  mockUsersRolesMaybeSingle.mockReset();
  mockAdminUsersMaybeSingle.mockReset();
  mockProducersMaybeSingle.mockReset();
  // F-026 default : aucune révocation enregistrée pour ce user (cas nominal).
  mockRpcGetRevocation.mockReset();
  mockRpcGetRevocation.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ROLE_SNAPSHOT_SECRET;
  else process.env.ROLE_SNAPSHOT_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_SUPABASE_URL === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_ANON === undefined)
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_SUPABASE_ANON;
});

import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

function buildRequest(opts: {
  url: string;
  host: string;
  cookies?: Record<string, string>;
}): NextRequest {
  const headers = new Headers({ host: opts.host });
  if (opts.cookies) {
    const cookieHeader = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    headers.set("cookie", cookieHeader);
  }
  return new NextRequest(opts.url, { headers });
}

describe("middleware — role snapshot cookie cache (T-321)", () => {
  it("cache HIT : cookie valide + user.id match → skip DB lookup users/admin_users", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));

    const cookieValue = await signRoleSnapshot({
      user_id: "user-1",
      roles: ["consumer"],
      isAdmin: false,
      expires_at: Date.now() + 60_000,
    });

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": cookieValue },
      }),
    );

    // CACHE HIT : aucune query users/admin_users (block 3 needsAuth+user).
    expect(mockUsersRolesMaybeSingle).not.toHaveBeenCalled();
    expect(mockAdminUsersMaybeSingle).not.toHaveBeenCalled();
  });

  it("cache MISS (cookie absent) : DB lookup parallèle users + admin_users + cookie posé en réponse", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockUsersRolesMaybeSingle.mockResolvedValue({
      data: { roles: ["consumer"] },
    });
    mockAdminUsersMaybeSingle.mockResolvedValue({ data: null });

    const response = await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);

    // Cookie role snapshot posé sur la réponse fallthrough.
    // Audit M-2 : nom prod = __Secure-terroir_role_snapshot (prefix __Secure-).
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain("__Secure-terroir_role_snapshot=");
  });

  it("chantier 6 : admin SUSPENDU au DB lookup → snapshot posé avec isAdmin=false", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockUsersRolesMaybeSingle.mockResolvedValue({ data: null });
    // Le lookup admin_users remonte une ligne suspendue (suspended_at non null).
    mockAdminUsersMaybeSingle.mockResolvedValue({
      data: { id: "user-1", suspended_at: "2026-05-20T10:00:00Z" },
    });

    const response = await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
      }),
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    const m = setCookie.match(/__Secure-terroir_role_snapshot=([^;]+)/);
    expect(m).not.toBeNull();
    const payload = await parseAndVerifyRoleSnapshot(
      decodeURIComponent(m![1]),
    );
    // Un admin suspendu ne doit JAMAIS être isAdmin=true, même en cache neuf.
    expect(payload?.isAdmin).toBe(false);
  });

  it("cache INVALID (signature corrompue) : fallback DB lookup", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockUsersRolesMaybeSingle.mockResolvedValue({
      data: { roles: ["consumer"] },
    });
    mockAdminUsersMaybeSingle.mockResolvedValue({ data: null });

    // Cookie avec signature invalide → parseAndVerifyRoleSnapshot retourne null.
    const tamperedCookie = "tampered." + "0".repeat(64);

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": tamperedCookie },
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("cache EXPIRÉ : fallback DB lookup", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockUsersRolesMaybeSingle.mockResolvedValue({
      data: { roles: ["consumer"] },
    });
    mockAdminUsersMaybeSingle.mockResolvedValue({ data: null });

    const expiredCookie = await signRoleSnapshot({
      user_id: "user-1",
      roles: ["consumer"],
      isAdmin: false,
      expires_at: Date.now() - 1, // expiré
    });

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": expiredCookie },
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("F-026 — snapshot frais (issued_at > min_issued_at) → utilise cache, pas de DB lookup", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));

    // Cookie émis maintenant (expires_at = now + TTL → issued_at = now).
    const cookieValue = await signRoleSnapshot({
      user_id: "user-1",
      roles: ["consumer"],
      isAdmin: false,
      expires_at: Date.now() + 15 * 60 * 1000,
    });

    // Révocation très ancienne (1h avant) → snapshot frais.
    mockRpcGetRevocation.mockResolvedValue({
      data: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      error: null,
    });

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": cookieValue },
      }),
    );

    // RPC consultée, mais le snapshot est plus récent → pas de DB lookup.
    expect(mockRpcGetRevocation).toHaveBeenCalledWith(
      "get_role_snapshot_revocation",
      { p_user_id: "user-1" },
    );
    expect(mockUsersRolesMaybeSingle).not.toHaveBeenCalled();
    expect(mockAdminUsersMaybeSingle).not.toHaveBeenCalled();
  });

  it("F-026 — snapshot stale (min_issued_at > issued_at) → force DB lookup refresh", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockUsersRolesMaybeSingle.mockResolvedValue({
      data: { roles: ["consumer", "producer"] }, // promu producer entre temps
    });
    mockAdminUsersMaybeSingle.mockResolvedValue({ data: null });

    // Cookie émis il y a 5min (expires_at = now + 10min → issued_at = now - 5min).
    const cookieValue = await signRoleSnapshot({
      user_id: "user-1",
      roles: ["consumer"],
      isAdmin: false,
      expires_at: Date.now() + 10 * 60 * 1000,
    });

    // Révocation 2min avant maintenant → après l'issued_at (now - 5min).
    // Donc issued_at < min_issued_at → snapshot stale.
    mockRpcGetRevocation.mockResolvedValue({
      data: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      error: null,
    });

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": cookieValue },
      }),
    );

    // Snapshot stale → fallback DB lookup (refresh).
    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("cache USER_ID MISMATCH : autre user dans le cookie → fallback DB lookup", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockUsersRolesMaybeSingle.mockResolvedValue({
      data: { roles: ["consumer"] },
    });
    mockAdminUsersMaybeSingle.mockResolvedValue({ data: null });

    const otherUserCookie = await signRoleSnapshot({
      user_id: "user-2", // ≠ user-1 (getUser)
      roles: ["consumer"],
      isAdmin: false,
      expires_at: Date.now() + 60_000,
    });

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": otherUserCookie },
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });
});

// fix/middleware-subdomain-isolation — routes consumer (/compte) = www-only,
// routes producer = pro-only. Le middleware gate sur les hostnames PROD
// (pro.terroir-local.fr) → non testable en E2E localhost (host = localhost
// → isProducerHost faux). Couverture au niveau unitaire en forçant l'URL pro.
describe("middleware — isolation rôles/sous-domaine (pro.* vs www.*)", () => {
  async function snapshotCookie(roles: string[], isAdmin = false) {
    return signRoleSnapshot({
      user_id: "user-1",
      roles,
      isAdmin,
      expires_at: Date.now() + 60_000,
    });
  }

  it("consumer-only connecté sur pro.*/compte → 307 vers www.*/compte (pas de boucle)", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/compte",
        host: "pro.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": await snapshotCookie(["consumer"]) },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.terroir-local.fr/compte");
  });

  it("producteur connecté sur pro.*/compte → 307 vers www.*/compte (compte = consumer)", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/compte/factures",
        host: "pro.terroir-local.fr",
        cookies: {
          "__Secure-terroir_role_snapshot": await snapshotCookie(["consumer", "producer"]),
        },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://www.terroir-local.fr/compte/factures",
    );
  });

  it("non-connecté sur pro.*/compte → 307 vers www.*/compte (l'auth se fera sur www)", async () => {
    mockGetClaims.mockResolvedValue(noClaimsResult());
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/compte",
        host: "pro.terroir-local.fr",
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.terroir-local.fr/compte");
  });

  it("consumer-only connecté sur pro.*/dashboard (chemin producteur) → 307 vers www.* racine", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/dashboard",
        host: "pro.terroir-local.fr",
        cookies: { "__Secure-terroir_role_snapshot": await snapshotCookie(["consumer"]) },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.terroir-local.fr/");
  });

  it("non-connecté sur pro.*/dashboard → /connexion (flow existant, pas de fuite vers www)", async () => {
    mockGetClaims.mockResolvedValue(noClaimsResult());
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/dashboard",
        host: "pro.terroir-local.fr",
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/connexion");
  });

  it("producteur (statut active) sur pro.*/dashboard → reste sur pro.* (pas de redirect www)", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockProducersMaybeSingle.mockResolvedValue({ data: { statut: "active" }, error: null });
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/dashboard",
        host: "pro.terroir-local.fr",
        cookies: {
          "__Secure-terroir_role_snapshot": await snapshotCookie(["consumer", "producer"]),
        },
      }),
    );
    expect(res.headers.get("location") ?? "").not.toContain("www.terroir-local.fr");
  });

  it("producteur (statut draft) sur pro.*/ma-page → /onboarding (signup), pas www.*", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1"));
    mockProducersMaybeSingle.mockResolvedValue({ data: { statut: "draft" }, error: null });
    const res = await middleware(
      buildRequest({
        url: "https://pro.terroir-local.fr/ma-page",
        host: "pro.terroir-local.fr",
        cookies: {
          "__Secure-terroir_role_snapshot": await snapshotCookie(["consumer", "producer"]),
        },
      }),
    );
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/onboarding");
    expect(loc).not.toContain("www.terroir-local.fr");
  });
});

// Perf (Lot A) — mécanisme de vérification de session : getClaims (validation
// LOCALE du JWT) et non plus getUser (round-trip réseau). Le mock @supabase/ssr
// n'expose QUE getClaims ; ces tests verrouillent que c'est bien la méthode
// appelée par le chemin chaud et que le fail-closed est préservé.
describe("middleware — vérification session via getClaims (Lot A)", () => {
  it("appelle auth.getClaims() (et non getUser) sur une route protégée", async () => {
    mockGetClaims.mockResolvedValue(claimsResult("user-1", "alice@example.com"));
    mockUsersRolesMaybeSingle.mockResolvedValue({ data: { roles: ["consumer"] } });
    mockAdminUsersMaybeSingle.mockResolvedValue({ data: null });

    await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
      }),
    );

    expect(mockGetClaims).toHaveBeenCalledTimes(1);
  });

  it("fail-closed : data=null (JWT invalide/absent) → traité comme non-connecté → /connexion", async () => {
    // getClaims renvoie data:null sur un JWT invalide ou absent. Le middleware
    // doit se comporter comme avec user=null : route protégée → /connexion.
    mockGetClaims.mockResolvedValue(noClaimsResult());

    const res = await middleware(
      buildRequest({
        url: "https://www.terroir-local.fr/compte",
        host: "www.terroir-local.fr",
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/connexion");
    // Aucun lookup rôle déclenché : on n'a pas d'identité.
    expect(mockUsersRolesMaybeSingle).not.toHaveBeenCalled();
    expect(mockAdminUsersMaybeSingle).not.toHaveBeenCalled();
  });
});
