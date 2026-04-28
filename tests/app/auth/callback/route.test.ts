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
} = vi.hoisted(() => ({
  mockVerifyOtp: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockCanonicalPostLoginUrl: vi.fn(),
  mockLoadRoleSnapshot: vi.fn(),
  mockReadRedirectAfterAuth: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
    },
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
