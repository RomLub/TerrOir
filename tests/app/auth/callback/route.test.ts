// Tests vitest pour GET /auth/callback.
//
// Stratégie : mock createServerClient (Supabase) + helpers lib/auth/*.
// Tests baseline post-suppression code mort PKCE ?code= legacy
// (commit 09c219d a basculé le flow magic link sur ?token_hash= OTP).
// Vérifie :
// - flow PKCE moderne (token_hash + type) → verifyOtp appelé
// - fallback "Missing token_hash" sur params manquants
// - ?code= seul tombe désormais en fallback (le route handler ne
//   traite plus ?code= comme PKCE legacy)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const {
  mockVerifyOtp,
  mockExchangeCodeForSession,
  mockGetUser,
  mockCanonicalPostLoginUrl,
  mockLoadRoleSnapshot,
  mockReadRedirectAfterAuth,
  mockLogAuthEvent,
  mockMaskEmail,
  mockUsersUpdate,
  mockUsersUpdateEq,
} = vi.hoisted(() => ({
  mockVerifyOtp: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockCanonicalPostLoginUrl: vi.fn(),
  mockLoadRoleSnapshot: vi.fn(),
  mockReadRedirectAfterAuth: vi.fn(),
  mockLogAuthEvent: vi.fn(),
  mockMaskEmail: vi.fn(),
  mockUsersUpdate: vi.fn(),
  mockUsersUpdateEq: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
    },
    from: (table: string) => ({
      update: (payload: unknown) => {
        mockUsersUpdate(table, payload);
        return {
          eq: (col: string, val: unknown) => {
            mockUsersUpdateEq(col, val);
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
  }),
}));

vi.mock("@/lib/supabase/cookie-domain", () => ({
  cookieConfigForHost: () => ({}),
}));

vi.mock("@/lib/auth/post-login-redirect", () => ({
  canonicalPostLoginUrlWithRedirect: mockCanonicalPostLoginUrl,
  loadRoleSnapshot: mockLoadRoleSnapshot,
}));

vi.mock("@/lib/auth/redirect-cookie", () => ({
  readRedirectAfterAuth: mockReadRedirectAfterAuth,
  clearRedirectAfterAuth: vi.fn(),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: mockLogAuthEvent,
}));

vi.mock("@/lib/rgpd/mask-email", () => ({
  maskEmail: mockMaskEmail,
}));

import { GET } from "@/app/auth/callback/route";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockVerifyOtp.mockReset();
  mockExchangeCodeForSession.mockReset();
  mockGetUser.mockReset();
  mockCanonicalPostLoginUrl.mockReset();
  mockLoadRoleSnapshot.mockReset();
  mockReadRedirectAfterAuth.mockReset();
  mockReadRedirectAfterAuth.mockReturnValue(null);
  mockLogAuthEvent.mockReset();
  mockLogAuthEvent.mockResolvedValue(undefined);
  mockMaskEmail.mockReset();
  mockMaskEmail.mockImplementation((email: string) => `m_${email}`);
  mockUsersUpdate.mockReset();
  mockUsersUpdateEq.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildRequest(query: string): NextRequest {
  return new NextRequest(
    `https://www.terroir-local.fr/auth/callback${query}`,
  );
}

describe("GET /auth/callback — flow PKCE moderne (token_hash + type)", () => {
  it("token_hash + type=magiclink → verifyOtp appelé, exchangeCodeForSession jamais appelé", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockLoadRoleSnapshot.mockResolvedValue("consumer");
    mockCanonicalPostLoginUrl.mockReturnValue(
      new URL("https://www.terroir-local.fr/"),
    );

    const res = await GET(buildRequest("?token_hash=abc123&type=magiclink"));

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "abc123",
      type: "magiclink",
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    // NextResponse.redirect = 307 par défaut.
    expect(res.status).toBe(307);
  });

  it("token_hash + type=recovery → redirect /reinitialiser-mot-de-passe", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const res = await GET(buildRequest("?token_hash=xyz&type=recovery"));

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "xyz",
      type: "recovery",
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/reinitialiser-mot-de-passe");
  });
});

describe("GET /auth/callback — fallback erreur params manquants", () => {
  it("aucun param → redirect /connexion?error=auth_callback&reason=Missing+token_hash", async () => {
    const res = await GET(buildRequest(""));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/connexion");
    expect(location).toContain("error=auth_callback");
    expect(location).toContain("reason=Missing+token_hash");
  });

  it("?code= seul (legacy params) → fallback erreur, exchangeCodeForSession jamais appelé (post-suppression code mort PKCE)", async () => {
    const res = await GET(buildRequest("?code=legacy123"));

    // Confirme que la branche if (code) a bien été supprimée :
    // ?code= n'est plus traité comme PKCE, exchangeCodeForSession n'est
    // plus invoqué et la requête tombe en fallback "Missing token_hash".
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/connexion");
    expect(location).toContain("error=auth_callback");
    expect(location).toContain("reason=Missing+token_hash");
  });
});

describe("GET /auth/callback — Phase 3 multi-events audit (T-081 PR-A)", () => {
  it("type=email_change → sync public.users.email + logAuthEvent('email_change') avec new_email_masked", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-42", email: "new@example.com" } },
    });
    mockLoadRoleSnapshot.mockResolvedValue({
      isAdmin: false,
      isProducer: false,
      producerStatut: null,
    });
    mockCanonicalPostLoginUrl.mockReturnValue(
      new URL("https://www.terroir-local.fr/compte"),
    );

    await GET(buildRequest("?token_hash=abc&type=email_change"));

    // Sync public.users.email = auth.users.email (résout désynchro flow profil
    // pré-bascule supabase.auth.updateUser).
    expect(mockUsersUpdate).toHaveBeenCalledWith("users", {
      email: "new@example.com",
    });
    expect(mockUsersUpdateEq).toHaveBeenCalledWith("id", "user-42");

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      eventType: "email_change",
      userId: "user-42",
      metadata: { new_email_masked: "m_new@example.com" },
    });
  });

  it("type=magiclink + role.isAdmin=true → logAuthEvent('admin_login') avec source='magic_link'", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", email: "admin@example.com" } },
    });
    mockLoadRoleSnapshot.mockResolvedValue({
      isAdmin: true,
      isProducer: false,
      producerStatut: null,
    });
    mockCanonicalPostLoginUrl.mockReturnValue(
      new URL("https://admin.terroir-local.fr/tableau-de-bord"),
    );

    await GET(buildRequest("?token_hash=abc&type=magiclink"));

    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      eventType: "admin_login",
      userId: "admin-1",
      metadata: { source: "magic_link" },
    });
  });

  it("type=magiclink + role.isAdmin=false → admin_login NON loggué (event security-critical réservé admin)", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
    });
    mockLoadRoleSnapshot.mockResolvedValue({
      isAdmin: false,
      isProducer: false,
      producerStatut: null,
    });
    mockCanonicalPostLoginUrl.mockReturnValue(
      new URL("https://www.terroir-local.fr/compte"),
    );

    await GET(buildRequest("?token_hash=abc&type=magiclink"));

    expect(
      mockLogAuthEvent.mock.calls.find(
        (call) => (call[0] as { eventType: string }).eventType === "admin_login",
      ),
    ).toBeUndefined();
  });

  it("type=recovery → ni email_change ni admin_login loggué (branche short-circuit)", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    await GET(buildRequest("?token_hash=xyz&type=recovery"));

    // recovery prend la branche else if (type === "recovery") qui ne fait
    // pas getUser et donc ne tombe jamais dans le bloc Phase 3.
    expect(mockLogAuthEvent).not.toHaveBeenCalled();
  });
});
