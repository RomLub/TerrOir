import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Secret figé pour signatures déterministes des cookies de test.
const TEST_SECRET = "c".repeat(64);
const ORIGINAL_SECRET = process.env.ROLE_SNAPSHOT_SECRET;
const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Mocks @supabase/ssr injectés via vi.mock factory (hoisting). On expose
// des hooks mutables pour customiser par test.
const mockGetUser = vi.fn();
const mockUsersRolesMaybeSingle = vi.fn();
const mockAdminUsersMaybeSingle = vi.fn();
const mockProducersMaybeSingle = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => mockGetUser(),
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
  }),
}));

import { signRoleSnapshot } from "@/lib/auth/role-snapshot-cookie";

beforeEach(() => {
  process.env.ROLE_SNAPSHOT_SECRET = TEST_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  mockGetUser.mockReset();
  mockUsersRolesMaybeSingle.mockReset();
  mockAdminUsersMaybeSingle.mockReset();
  mockProducersMaybeSingle.mockReset();
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
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

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
        cookies: { __terroir_role_snapshot: cookieValue },
      }),
    );

    // CACHE HIT : aucune query users/admin_users (block 3 needsAuth+user).
    expect(mockUsersRolesMaybeSingle).not.toHaveBeenCalled();
    expect(mockAdminUsersMaybeSingle).not.toHaveBeenCalled();
  });

  it("cache MISS (cookie absent) : DB lookup parallèle users + admin_users + cookie posé en réponse", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
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
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain("__terroir_role_snapshot=");
  });

  it("cache INVALID (signature corrompue) : fallback DB lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
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
        cookies: { __terroir_role_snapshot: tamperedCookie },
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("cache EXPIRÉ : fallback DB lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
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
        cookies: { __terroir_role_snapshot: expiredCookie },
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("cache USER_ID MISMATCH : autre user dans le cookie → fallback DB lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
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
        cookies: { __terroir_role_snapshot: otherUserCookie },
      }),
    );

    expect(mockUsersRolesMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mockAdminUsersMaybeSingle).toHaveBeenCalledTimes(1);
  });
});
