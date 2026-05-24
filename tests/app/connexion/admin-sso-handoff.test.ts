import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests du SSO admin (une seule saisie de mot de passe) ajouté à loginAction :
// un admin qui se connecte sur www/pro est redirigé vers le callback admin.*
// avec un jeton magic-link à usage unique (généré côté serveur), au lieu de
// devoir re-saisir son mdp. Fail-safe : si generateLink échoue → redirect
// normal.

const env = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
  return {};
});
void env;

const h = vi.hoisted(() => ({
  host: { value: "www.terroir-local.fr" },
  signIn: vi.fn(),
  loadRole: vi.fn(),
  resolvePath: vi.fn(() => "/tableau-de-bord"),
  generateLink: vi.fn(),
  // redirect() throw NEXT_REDIRECT en vrai → on reproduit pour stopper l'exécution.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k === "host" ? h.host.value : null) }),
  cookies: async () => ({}),
}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: (...a: unknown[]) => h.signIn(...a) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { generateLink: (...a: unknown[]) => h.generateLink(...a) } },
  }),
}));
vi.mock("@/lib/auth/post-login-redirect", () => ({
  loadRoleSnapshot: (...a: unknown[]) => h.loadRole(...a),
  resolvePostLoginPath: (...a: unknown[]) => h.resolvePath(...a),
}));
vi.mock("@/lib/auth/role-snapshot-cookie", () => ({ setRoleSnapshotOnStore: vi.fn() }));
vi.mock("@/lib/auth/redirect-cookie", () => ({ setRedirectAfterAuth: vi.fn() }));
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: vi.fn(),
  extractRequestContext: () => ({ ipAddress: "203.0.113.5", userAgent: null }),
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
  getLoginRateLimit: () => ({}),
  getMagicLinkRateLimit: () => ({}),
  getRecoveryRateLimit: () => ({}),
}));

import { loginAction } from "@/app/connexion/actions";

function fd(): FormData {
  const f = new FormData();
  f.set("email", "admin@terroir-local.fr");
  f.set("password", "secret123");
  return f;
}

beforeEach(() => {
  h.host.value = "www.terroir-local.fr";
  h.signIn.mockReset().mockResolvedValue({
    data: { user: { id: "u1", email: "admin@terroir-local.fr" } },
    error: null,
  });
  h.loadRole.mockReset().mockResolvedValue({
    isAdmin: true,
    isProducer: false,
    producerStatut: null,
    roles: [],
  });
  h.resolvePath.mockReset().mockReturnValue("/tableau-de-bord");
  h.generateLink
    .mockReset()
    .mockResolvedValue({ data: { properties: { hashed_token: "TOK" } }, error: null });
  h.redirect.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loginAction — SSO admin handoff", () => {
  it("admin sur www → redirect vers le callback admin.* avec token_hash (pas de 2e login)", async () => {
    await expect(loginAction({}, fd())).rejects.toThrow(
      "NEXT_REDIRECT:https://admin.terroir-local.fr/auth/callback?token_hash=TOK&type=magiclink",
    );
    expect(h.generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "admin@terroir-local.fr",
    });
  });

  it("admin sur pro → handoff aussi (cookie partagé www/pro, isolé d'admin.*)", async () => {
    h.host.value = "pro.terroir-local.fr";
    await expect(loginAction({}, fd())).rejects.toThrow(/admin\.terroir-local\.fr\/auth\/callback\?token_hash=TOK/);
  });

  it("admin DÉJÀ sur admin.* → pas de handoff, redirect local normal", async () => {
    h.host.value = "admin.terroir-local.fr";
    await expect(loginAction({}, fd())).rejects.toThrow("NEXT_REDIRECT:/tableau-de-bord");
    expect(h.generateLink).not.toHaveBeenCalled();
  });

  it("non-admin sur www → pas de handoff", async () => {
    h.loadRole.mockResolvedValue({
      isAdmin: false,
      isProducer: false,
      producerStatut: null,
      roles: ["consumer"],
    });
    await expect(loginAction({}, fd())).rejects.toThrow("NEXT_REDIRECT:/tableau-de-bord");
    expect(h.generateLink).not.toHaveBeenCalled();
  });

  it("generateLink échoue → fail-safe : redirect normal (pas de handoff)", async () => {
    h.generateLink.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(loginAction({}, fd())).rejects.toThrow("NEXT_REDIRECT:/tableau-de-bord");
  });
});
