import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

// --- Mocks ---------------------------------------------------------------
// Builder Supabase admin chainable + signInWithPassword mockable. Pattern aligné
// sur create-account.test.ts.

type Resp = { data?: unknown; error?: unknown };

let captured: {
  fromCalls: string[];
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
};
let responses: Record<string, Resp[]>;
let signInMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const resp = responses[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.ilike = (col: string, val: unknown) => {
        captured.ilikeCalls.push({ table, col, val });
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        return Promise.resolve(resp);
      };
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => signInMock(...args),
    },
  }),
}));

const logAuthEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: logAuthEventMock,
  extractRequestContext: () => ({
    ipAddress: "203.0.113.5",
    userAgent: null,
  }),
}));

// T-305 PR-B : mock rate-limit (consume + getLoginRateLimit). next/headers mock
// consolidé avec T-321 ci-dessous (le module ne peut être mocké qu'une fois).
const consumeRateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
);

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: consumeRateLimitMock,
  getLoginRateLimit: () => ({}),
}));

// T-321 — Mock no-op pour role-snapshot-cookie (server-only virtuel Next).
vi.mock("@/lib/auth/role-snapshot-cookie", () => ({
  clearRoleSnapshotOnStore: vi.fn(),
}));

// next/headers expose à la fois cookies (T-321 clearRoleSnapshotOnStore) et
// headers (T-305 PR-B extractRequestContext + T-321 host lookup).
vi.mock("next/headers", () => ({
  cookies: () => ({ set: vi.fn() }),
  headers: () => ({ get: vi.fn(() => null) }),
}));

import { loginAndUpgradeAction } from "@/app/(public)/invitation/_actions/login-and-upgrade";

// --- Helpers --------------------------------------------------------------

const VALID_TOKEN = "a".repeat(32);

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("token", VALID_TOKEN);
  fd.set("password", "password123");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function validInvitationResp(email = "user@example.com"): Resp {
  return {
    data: {
      id: "inv-1",
      email,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_at: null,
    },
    error: null,
  };
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  captured = {
    fromCalls: [],
    inserts: [],
    updates: [],
    ilikeCalls: [],
    eqCalls: [],
  };
  responses = {};
  signInMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ data: {}, error: null });
  logAuthEventMock.mockReset();
  logAuthEventMock.mockResolvedValue(undefined);
  consumeRateLimitMock.mockReset();
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("loginAndUpgradeAction", () => {
  it("happy path : user consumer existant → signIn OK + UPDATE roles avec 'producer' + INSERT producers si absent", async () => {
    responses.producer_invitations = [validInvitationResp("consumer@example.com")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    // 2e select sur producers (existingProducer) → null = pas de fiche existante
    responses.producers = [{ data: null, error: null }];

    const res = await loginAndUpgradeAction({}, makeFormData());

    expect(res).toEqual({ success: true });
    expect(signInMock).toHaveBeenCalledWith({
      email: "consumer@example.com",
      password: "password123",
    });
    expect(captured.updates).toContainEqual({
      table: "users",
      payload: { roles: ["consumer", "producer"] },
    });
    expect(captured.inserts.find((i) => i.table === "producers")?.payload).toMatchObject({
      user_id: "user-42",
      statut: "draft",
    });
    // Phase 3 multi-events audit (T-081 PR-A) : event role_changed loggué
    // après UPDATE roles succès, AVANT INSERT producers.
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "role_changed",
      userId: "user-42",
      metadata: { from: "consumer", to: "producer" },
    });
  });

  it("invitation expirée → error + audit log admin_invite_expired (userId=null, surface=login_and_upgrade)", async () => {
    responses.producer_invitations = [
      {
        data: {
          id: "inv-1",
          email: "user@example.com",
          expires_at: new Date(Date.now() - 1000).toISOString(),
          used_at: null,
        },
        error: null,
      },
    ];

    const res = await loginAndUpgradeAction({}, makeFormData());

    expect(res).toEqual({ error: "Invitation expirée" });
    expect(signInMock).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
    // T-081 — audit log admin_invite_expired. userId=null car le
    // signInWithPassword n'a pas encore eu lieu sur ce surface (l'user n'a
    // pas de session établie au moment du check).
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "admin_invite_expired",
      userId: null,
      metadata: {
        invitation_id: "inv-1",
        token_prefix: VALID_TOKEN.substring(0, 8),
        surface: "login_and_upgrade",
      },
    });
  });

  it("schema invalide (password vide) → error sans toucher signIn", async () => {
    const res = await loginAndUpgradeAction({}, makeFormData({ password: "" }));

    expect(res.error).toBeDefined();
    expect(signInMock).not.toHaveBeenCalled();
    expect(captured.fromCalls).toEqual([]);
  });

  it("T-304 : aucun user trouvé pour cet email → error générique 'Identifiants incorrects' + console.warn forensique", async () => {
    responses.producer_invitations = [validInvitationResp("ghost@example.com")];
    responses.users = [{ data: null, error: null }];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await loginAndUpgradeAction({}, makeFormData());

    // T-304 : message générique commun avec cas signinError pour bloquer
    // l'énumération email-vs-password côté UI.
    expect(res).toEqual({ error: "Identifiants incorrects" });
    expect(signInMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(
      /INVITATION_LOGIN_NO_USER email=ghost@example\.com/,
    );

    warnSpy.mockRestore();
  });

  it("T-304 : mot de passe incorrect → error générique 'Identifiants incorrects' + console.warn forensique", async () => {
    responses.producer_invitations = [validInvitationResp("user@example.com")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    signInMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await loginAndUpgradeAction({}, makeFormData());

    // CHAÎNE EXACTE IDENTIQUE à cas !existingUser pour preuve textuelle
    // d'enumeration-resistance côté UI.
    expect(res).toEqual({ error: "Identifiants incorrects" });
    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
    // Phase 3 audit : pas de role_changed loggué si auth a échoué
    expect(logAuthEventMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(
      /INVITATION_LOGIN_SIGNIN_FAIL email=user@example\.com message=Invalid login credentials/,
    );

    warnSpy.mockRestore();
  });

  it("T-110 : lookup users via .ilike (case-insensitive) — invitation.email en majuscules matche users.email en minuscules", async () => {
    responses.producer_invitations = [validInvitationResp("Consumer@Example.COM")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    responses.producers = [{ data: null, error: null }];

    await loginAndUpgradeAction({}, makeFormData());

    expect(captured.ilikeCalls).toContainEqual({
      table: "users",
      col: "email",
      val: "Consumer@Example.COM",
    });
    const eqEmailUsers = captured.eqCalls.find(
      (e) => e.table === "users" && e.col === "email",
    );
    expect(eqEmailUsers).toBeUndefined();
  });

  // --- T-305 PR-B — rate-limit applicatif IP (5/60s mutualisé login) -------

  it("T-305 PR-B : cap dépassé → audit rate_limit_exceeded route=invitation_login + error FR + lookup token NON appelé", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: 9999,
    });
    responses.producer_invitations = [validInvitationResp("user@example.com")];

    const res = await loginAndUpgradeAction({}, makeFormData());

    expect(res).toEqual({
      error: "Trop de tentatives. Réessayez dans quelques minutes.",
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "invitation_login", cap: 5, reset: 9999 },
    });
    // Ni lookup invitation, ni signIn, ni role_changed (short-circuit).
    expect(captured.fromCalls).toEqual([]);
    expect(signInMock).not.toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "role_changed" }),
    );
  });

  it("T-305 PR-B : cap OK → consumeRateLimit appelé avec IP extraite + flow nominal continue", async () => {
    responses.producer_invitations = [validInvitationResp("user@example.com")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    responses.producers = [{ data: null, error: null }];

    await loginAndUpgradeAction({}, makeFormData());

    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.5",
    );
    expect(signInMock).toHaveBeenCalled();
  });
});
