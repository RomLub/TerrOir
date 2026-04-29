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
  mockRevalidatePath,
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
  mockRevalidatePath: vi.fn(),
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

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
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
  mockRevalidatePath.mockReset();
  // Silence console.error en test (T-318 trace forensique
  // AUTH_CALLBACK_ERROR + T-327 EMAIL_CHANGE_SYNC_ERROR), restauré
  // par vi.restoreAllMocks() en afterEach.
  vi.spyOn(console, "error").mockImplementation(() => {});
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

describe("GET /auth/callback — fallback erreur params manquants (codes symboliques T-318)", () => {
  it("aucun param → redirect /connexion?error=auth_callback&reason=missing + console.error AUTH_CALLBACK_ERROR", async () => {
    const res = await GET(buildRequest(""));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/connexion");
    expect(location).toContain("error=auth_callback");
    // T-318 : code symbolique court "missing" au lieu du verbatim
    // "Missing token_hash" qui fuyait dans la query string.
    expect(location).toContain("reason=missing");
    expect(location).not.toContain("Missing+token_hash");
    // Verbatim conservé côté logs Vercel pour debug forensique.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("AUTH_CALLBACK_ERROR"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Missing token_hash"),
    );
  });

  it("?code= seul (legacy params) → fallback erreur reason=missing, exchangeCodeForSession jamais appelé (post-suppression code mort PKCE)", async () => {
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
    expect(location).toContain("reason=missing");
  });
});

describe("GET /auth/callback — classification erreurs verifyOtp (T-318 anti info disclosure)", () => {
  it("verifyOtp 'Token has expired or is invalid' → reason=expired + verbatim côté logs (jamais query string)", async () => {
    mockVerifyOtp.mockResolvedValue({
      error: { message: "Token has expired or is invalid" },
    });

    const res = await GET(buildRequest("?token_hash=abc&type=magiclink"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=expired");
    expect(location).not.toContain("Token+has+expired");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("AUTH_CALLBACK_ERROR"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Token has expired or is invalid"),
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reason_code=expired"),
    );
  });

  it("verifyOtp 'User already confirmed' → reason=invalid (token déjà consommé classé invalid, pas expired)", async () => {
    mockVerifyOtp.mockResolvedValue({
      error: { message: "User already confirmed" },
    });

    const res = await GET(buildRequest("?token_hash=abc&type=signup"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=invalid");
    expect(location).not.toContain("already+confirmed");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("User already confirmed"),
    );
  });

  it("verifyOtp message inconnu non catégorisé → reason=technical (fallback default)", async () => {
    mockVerifyOtp.mockResolvedValue({
      error: { message: "Some unexpected Supabase error xyz" },
    });

    const res = await GET(buildRequest("?token_hash=abc&type=magiclink"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=technical");
    expect(location).not.toContain("unexpected");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Some unexpected Supabase error xyz"),
    );
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

describe("GET /auth/callback — case type=signup (T-300 audit déplacé post-confirm)", () => {
  it("type=signup + ?next=/compte/commandes → verifyOtp + audit account_signup + revalidatePath + redirect honoré", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-99", email: "new@example.com" } },
    });

    const res = await GET(
      buildRequest("?token_hash=signup-tok&type=signup&next=/compte/commandes"),
    );

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: "signup-tok",
      type: "signup",
    });
    expect(mockLogAuthEvent).toHaveBeenCalledWith({
      eventType: "account_signup",
      userId: "user-99",
      metadata: { source: "consumer_signup_form" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(res.status).toBe(307);
    expect(res.headers.get("location") ?? "").toContain("/compte/commandes");
  });

  it("type=signup sans user (verifyOtp suspect) → audit NON loggué, revalidatePath quand même appelé", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await GET(buildRequest("?token_hash=tok&type=signup&next=/compte/commandes"));

    expect(mockLogAuthEvent).not.toHaveBeenCalled();
    // revalidatePath est gated sur type==="signup", pas sur user — il
    // tourne quand même pour refresh le RootLayout cache, comportement
    // sûr (no-op si layout pas encore rendu).
    expect(mockRevalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
