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
      builder.eq = () => builder;
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
  createSupabaseServerClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => signInMock(...args),
    },
  }),
}));

const logAuthEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: logAuthEventMock,
}));

import { loginAndUpgradeAction } from "@/app/(producer)/invitation/_actions/login-and-upgrade";

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
  captured = { fromCalls: [], inserts: [], updates: [] };
  responses = {};
  signInMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ data: {}, error: null });
  logAuthEventMock.mockReset();
  logAuthEventMock.mockResolvedValue(undefined);
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
});
