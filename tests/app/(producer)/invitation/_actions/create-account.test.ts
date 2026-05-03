import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

// --- Mocks ---------------------------------------------------------------
// Builder Supabase admin chainable (pattern aligné sur complete-onboarding.test.ts)
// + .auth.admin.createUser mockable au niveau du client. Les responses par table
// sont configurables via `responses[table]` ; defaults raisonnables sinon.

type Resp = { data?: unknown; error?: unknown };

let captured: {
  fromCalls: string[];
  inserts: Array<{ table: string; payload: unknown }>;
};
let responses: Record<string, Resp[]>;
let createUserMock: Mock<AnyAsyncFn>;
let deleteUserMock: Mock<AnyAsyncFn>;
let signInMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: (...args: unknown[]) => createUserMock(...args),
        deleteUser: (...args: unknown[]) => deleteUserMock(...args),
      },
    },
    from: (table: string) => {
      captured.fromCalls.push(table);
      const resp = responses[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
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

// T-305 PR-B : mocks rate-limit + audit-log + next/headers.
vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({ get: () => null })),
}));

const consumeRateLimitMock = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
);
const logAuthEventMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: consumeRateLimitMock,
  getSignupRateLimit: () => ({}),
}));

vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: logAuthEventMock,
  extractRequestContext: () => ({
    ipAddress: "203.0.113.5",
    userAgent: null,
  }),
}));

import { createAccountAction } from "@/app/(producer)/invitation/_actions/create-account";

// --- Helpers --------------------------------------------------------------

const VALID_TOKEN = "a".repeat(32);

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("token", VALID_TOKEN);
  fd.set("password", "Password123");
  fd.set("passwordConfirm", "Password123");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

// Invitation valide par défaut (expires_at futur, used_at null).
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
  captured = { fromCalls: [], inserts: [] };
  responses = {};
  createUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    data: { user: { id: "user-42" } },
    error: null,
  });
  deleteUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ data: null, error: null });
  signInMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ data: {}, error: null });
  consumeRateLimitMock.mockReset();
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: 0,
  });
  logAuthEventMock.mockReset();
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("createAccountAction", () => {
  it("happy path : invitation valide → success + INSERT users/producers + signIn", async () => {
    responses.producer_invitations = [validInvitationResp("new@example.com")];

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({ success: true });
    expect(captured.fromCalls).toContain("producer_invitations");
    expect(captured.inserts.find((i) => i.table === "users")?.payload).toMatchObject({
      id: "user-42",
      email: "new@example.com",
      roles: ["consumer", "producer"],
    });
    expect(captured.inserts.find((i) => i.table === "producers")?.payload).toMatchObject({
      user_id: "user-42",
      statut: "draft",
    });
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "Password123",
    });
  });

  it("schema invalide (password < 8 chars) → error sans toucher la DB", async () => {
    const fd = makeFormData({ password: "short", passwordConfirm: "short" });

    const res = await createAccountAction({}, fd);

    expect(res.error).toMatch(/8 caractères/);
    expect(res.success).toBeUndefined();
    expect(captured.fromCalls).toEqual([]);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("invitation expirée → error + audit log admin_invite_expired (userId=null, surface=create_account)", async () => {
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

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({ error: "Invitation expirée" });
    expect(createUserMock).not.toHaveBeenCalled();
    // T-081 — audit log admin_invite_expired. userId=null car aucune session
    // établie sur ce surface (le user n'a pas encore de compte). token_prefix
    // = 8 premiers chars du token soumis (pas l'email en clair). surface
    // permet de discriminer entre les 4 server actions de claim sans nouveau
    // event_type.
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "admin_invite_expired",
      userId: null,
      metadata: {
        invitation_id: "inv-1",
        token_prefix: VALID_TOKEN.substring(0, 8),
        surface: "create_account",
      },
    });
  });

  it("createUser fail → error remonté tel quel", async () => {
    responses.producer_invitations = [validInvitationResp()];
    createUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: { message: "Email déjà enregistré" },
    });

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({ error: "Email déjà enregistré" });
    expect(captured.inserts).toEqual([]);
    expect(signInMock).not.toHaveBeenCalled();
  });

  // --- T-302 — compensation orphelin auth.users ---------------------------

  it("T-302 : INSERT users fail → admin.auth.admin.deleteUser appelé + error générique + pas de signIn", async () => {
    responses.producer_invitations = [validInvitationResp("new@example.com")];
    // INSERT users fail (resp[0] sur table 'users' = error).
    responses.users = [
      { data: null, error: { message: "duplicate key value violates unique constraint" } },
    ];

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({
      error: "Création du compte impossible. Réessayez plus tard.",
    });
    expect(deleteUserMock).toHaveBeenCalledWith("user-42");
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    // Rollback OK → pas de console.error orphan log.
    expect(errorSpy).not.toHaveBeenCalled();
    // signIn ne doit pas être tenté après échec INSERT users.
    expect(signInMock).not.toHaveBeenCalled();
    // INSERT producers ne doit pas avoir été tenté non plus.
    expect(captured.inserts.find((i) => i.table === "producers")).toBeUndefined();

    errorSpy.mockRestore();
  });

  it("T-302 : INSERT producers fail (post users OK) → admin.auth.admin.deleteUser appelé + error générique", async () => {
    responses.producer_invitations = [validInvitationResp("new@example.com")];
    // INSERT users OK + INSERT producers fail.
    responses.users = [{ data: null, error: null }];
    responses.producers = [
      { data: null, error: { message: "constraint violation siret" } },
    ];

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({
      error: "Création du compte impossible. Réessayez plus tard.",
    });
    expect(deleteUserMock).toHaveBeenCalledWith("user-42");
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    // INSERT users a bien eu lieu avant le fail producers.
    expect(captured.inserts.find((i) => i.table === "users")).toBeDefined();
    expect(captured.inserts.find((i) => i.table === "producers")).toBeDefined();
    expect(signInMock).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("T-302 : INSERT users fail + rollback deleteUser fail → console.error orphan log + error générique", async () => {
    responses.producer_invitations = [validInvitationResp("new@example.com")];
    responses.users = [
      { data: null, error: { message: "RLS denied" } },
    ];
    deleteUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: null,
      error: { message: "auth.users delete forbidden" },
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({
      error: "Création du compte impossible. Réessayez plus tard.",
    });
    expect(deleteUserMock).toHaveBeenCalledWith("user-42");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(
      /INVITATION_CREATE_ACCOUNT_ORPHAN_AUTH user_id=user-42 email=new@example\.com.*rollback_error=auth\.users delete forbidden/,
    );

    errorSpy.mockRestore();
  });

  // --- T-305 PR-B — rate-limit applicatif IP (5/60s mutualisé signup) ------

  it("T-305 PR-B : cap dépassé → audit rate_limit_exceeded route=invitation_create + error FR + lookup token NON appelé", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: 8888,
    });
    responses.producer_invitations = [validInvitationResp()];

    const res = await createAccountAction({}, makeFormData());

    expect(res).toEqual({
      error: "Trop de tentatives. Réessayez dans quelques minutes.",
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "invitation_create", cap: 5, reset: 8888 },
    });
    // Aucun call DB / Supabase admin tenté.
    expect(captured.fromCalls).toEqual([]);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("T-305 PR-B : cap OK → consumeRateLimit appelé avec IP extraite + flow nominal continue", async () => {
    responses.producer_invitations = [validInvitationResp("new@example.com")];

    await createAccountAction({}, makeFormData());

    expect(consumeRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "203.0.113.5",
    );
    expect(createUserMock).toHaveBeenCalled();
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
