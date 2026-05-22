import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Chantier 1 — requestAdminMagicLinkAction (accès admin en un clic depuis www).
// Session-based : envoie un magic link admin à l'adresse de la session, callback
// admin.* (cookie isolé), réservé aux admins.

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  signInWithOtp: vi.fn(),
  consumeRateLimit: vi.fn(),
  logAuthEvent: vi.fn(),
  getAuthCallbackUrl: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithOtp: (...a: unknown[]) => h.signInWithOtp(...a),
      signInWithPassword: vi.fn(),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...a: unknown[]) => h.consumeRateLimit(...a),
  getMagicLinkRateLimit: () => ({}),
  getLoginRateLimit: () => ({}),
  getRecoveryRateLimit: () => ({}),
}));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: (...a: unknown[]) => h.logAuthEvent(...a),
  extractRequestContext: () => ({ ipAddress: "1.2.3.4" }),
}));
vi.mock("@/lib/auth/email-redirect", () => ({
  getAuthCallbackUrl: (...a: unknown[]) => h.getAuthCallbackUrl(...a),
  getPasswordResetUrl: () => "https://x/reset",
}));
vi.mock("@/lib/auth/post-login-redirect", () => ({
  loadRoleSnapshot: vi.fn(),
  resolvePostLoginPath: () => "/",
  canonicalPostLoginUrlWithRedirect: () => "/",
}));
vi.mock("@/lib/auth/redirect-cookie", () => ({
  setRedirectAfterAuth: vi.fn(),
  readRedirectAfterAuth: () => null,
  clearRedirectAfterAuth: vi.fn(),
}));
vi.mock("@/lib/auth/role-snapshot-cookie", () => ({
  setRoleSnapshotOnStore: vi.fn(),
}));

import { requestAdminMagicLinkAction } from "@/app/connexion/actions";

const fd = () => new FormData();

beforeEach(() => {
  h.getSessionUser.mockReset();
  h.signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  h.consumeRateLimit.mockReset().mockResolvedValue({ success: true, limit: 3, reset: 0 });
  h.logAuthEvent.mockReset().mockResolvedValue(undefined);
  h.getAuthCallbackUrl.mockReset().mockReturnValue("https://admin.test.fr/auth/callback");
});
afterEach(() => vi.restoreAllMocks());

describe("requestAdminMagicLinkAction", () => {
  it("non connecté → refus générique, aucun envoi", async () => {
    h.getSessionUser.mockResolvedValue(null);
    const res = await requestAdminMagicLinkAction({}, fd());
    expect(res.error).toBeTruthy();
    expect(h.signInWithOtp).not.toHaveBeenCalled();
  });

  it("connecté NON admin → refus générique, aucun envoi, aucun audit magic link", async () => {
    h.getSessionUser.mockResolvedValue({
      id: "u1",
      email: "u@x.fr",
      isAdmin: false,
      roles: ["consumer"],
    });
    const res = await requestAdminMagicLinkAction({}, fd());
    expect(res.error).toMatch(/non autoris/i);
    expect(h.signInWithOtp).not.toHaveBeenCalled();
    expect(
      h.logAuthEvent.mock.calls.some(
        (c) => (c[0] as { eventType: string }).eventType === "account_login_magic_link",
      ),
    ).toBe(false);
  });

  it("admin → magic link envoyé à SA propre adresse, callback admin (true), audit source=admin_button", async () => {
    h.getSessionUser.mockResolvedValue({
      id: "admin-1",
      email: "Admin@X.fr",
      isAdmin: true,
      roles: ["consumer"],
    });
    const res = await requestAdminMagicLinkAction({}, fd());
    expect(res.message).toMatch(/envoyé/i);
    expect(h.getAuthCallbackUrl).toHaveBeenCalledWith(true);
    expect(h.signInWithOtp).toHaveBeenCalledWith({
      email: "Admin@X.fr",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://admin.test.fr/auth/callback",
      },
    });
    const audit = h.logAuthEvent.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "account_login_magic_link",
    );
    expect(audit?.[0]).toMatchObject({
      userId: "admin-1",
      metadata: { source: "admin_button" },
    });
  });

  it("rate-limit dépassé → refus + audit rate_limit_exceeded + aucun envoi", async () => {
    h.getSessionUser.mockResolvedValue({
      id: "admin-1",
      email: "a@x.fr",
      isAdmin: true,
      roles: [],
    });
    h.consumeRateLimit.mockResolvedValue({ success: false, limit: 3, reset: 0 });
    const res = await requestAdminMagicLinkAction({}, fd());
    expect(res.error).toMatch(/Trop de tentatives/);
    expect(h.signInWithOtp).not.toHaveBeenCalled();
    expect(
      h.logAuthEvent.mock.calls.some(
        (c) => (c[0] as { eventType: string }).eventType === "rate_limit_exceeded",
      ),
    ).toBe(true);
  });
});
