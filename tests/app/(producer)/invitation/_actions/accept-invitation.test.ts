import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---------------------------------------------------------------
// Pattern aligné sur login-and-upgrade.test.ts : capture des UPDATE/INSERT
// pour vérifier la mécanique idempotente sans toucher Supabase réel.

type Resp = { data?: unknown; error?: unknown };

let captured: {
  fromCalls: string[];
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
};
let responses: Record<string, Resp[]>;
let sessionUser: { id: string; email: string | null } | null;

// `redirect()` de next/navigation throw NEXT_REDIRECT en runtime — on remplace
// par une error marker qu'on peut asserter avec `.rejects.toThrow`.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

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

const logAuthEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: logAuthEventMock,
}));

// T-321 — `lib/auth/role-snapshot-cookie.ts` importe 'server-only' (virtuel
// Next.js). Mock no-op suffit : les tests vérifient les UPDATE/INSERT DB,
// pas l'invalidation cookie (couverte par tests/lib/auth/role-snapshot-cookie).
vi.mock("@/lib/auth/role-snapshot-cookie", () => ({
  clearRoleSnapshotOnStore: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ set: vi.fn() }),
  headers: () => ({ get: vi.fn(() => null) }),
}));

import { acceptInvitationAction } from "@/app/(producer)/invitation/_actions/accept-invitation";

// --- Helpers --------------------------------------------------------------

const VALID_TOKEN = "a".repeat(32);

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("token", VALID_TOKEN);
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
  sessionUser = null;
  logAuthEventMock.mockReset();
  logAuthEventMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("acceptInvitationAction (T-303 — bascule POST avec confirmation explicite)", () => {
  it("session null → error 'Session expirée' sans toucher la DB", async () => {
    sessionUser = null;

    const res = await acceptInvitationAction({}, makeFormData());

    expect(res).toEqual({ error: "Session expirée" });
    // Aucun `from(...)` ne doit avoir été émis : court-circuit dès l'entrée.
    expect(captured.fromCalls).toEqual([]);
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("session.email !== invitation.email → error mismatch sans mutation", async () => {
    sessionUser = { id: "user-x", email: "attacker@example.com" };
    responses.producer_invitations = [validInvitationResp("victim@example.com")];

    const res = await acceptInvitationAction({}, makeFormData());

    expect(res.error).toMatch(/correspond pas/i);
    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });

  it("T-110 : session.email vs invitation.email comparés case-insensitively (Bob@... matche bob@...)", async () => {
    // Cas réel : l'invitation a été créée pour 'consumer@example.com' mais
    // l'utilisateur s'est inscrit côté Supabase Auth avec 'Consumer@Example.COM'
    // (ou inversement). Le check ne doit PAS bloquer.
    sessionUser = { id: "user-42", email: "Consumer@Example.COM" };
    responses.producer_invitations = [validInvitationResp("consumer@example.com")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    responses.producers = [{ data: null, error: null }];

    await expect(acceptInvitationAction({}, makeFormData())).rejects.toThrow(
      "__REDIRECT__:/onboarding",
    );
    // Pas d'erreur "correspond pas" : la comparaison est passée.
    expect(captured.updates).toContainEqual({
      table: "users",
      payload: { roles: ["consumer", "producer"] },
    });
  });

  it("invitation déjà utilisée → error sans mutation", async () => {
    sessionUser = { id: "user-1", email: "user@example.com" };
    responses.producer_invitations = [
      {
        data: {
          id: "inv-1",
          email: "user@example.com",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: new Date().toISOString(),
        },
        error: null,
      },
    ];

    const res = await acceptInvitationAction({}, makeFormData());

    expect(res).toEqual({ error: "Invitation déjà utilisée" });
    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
  });

  it("invitation expirée → error sans mutation", async () => {
    sessionUser = { id: "user-1", email: "user@example.com" };
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

    const res = await acceptInvitationAction({}, makeFormData());

    expect(res).toEqual({ error: "Invitation expirée" });
    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
  });

  it("happy path : roles+producer absents → UPDATE roles + INSERT producer + audit role_changed + redirect /onboarding", async () => {
    sessionUser = { id: "user-42", email: "consumer@example.com" };
    responses.producer_invitations = [validInvitationResp("consumer@example.com")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    // 2e select sur producers (existingProducer pre-INSERT) → null
    responses.producers = [{ data: null, error: null }];

    await expect(acceptInvitationAction({}, makeFormData())).rejects.toThrow(
      "__REDIRECT__:/onboarding",
    );

    expect(captured.updates).toContainEqual({
      table: "users",
      payload: { roles: ["consumer", "producer"] },
    });
    expect(
      captured.inserts.find((i) => i.table === "producers")?.payload,
    ).toMatchObject({
      user_id: "user-42",
      statut: "draft",
    });
    expect(logAuthEventMock).toHaveBeenCalledWith({
      eventType: "role_changed",
      userId: "user-42",
      metadata: { from: "consumer", to: "producer" },
    });
  });

  it("T-110 : lookup users via .ilike (case-insensitive) — invitation.email en majuscules matche users.email en minuscules", async () => {
    sessionUser = { id: "user-42", email: "Consumer@Example.COM" };
    responses.producer_invitations = [validInvitationResp("Consumer@Example.COM")];
    responses.users = [
      { data: { id: "user-42", roles: ["consumer"] }, error: null },
    ];
    responses.producers = [{ data: null, error: null }];

    await expect(acceptInvitationAction({}, makeFormData())).rejects.toThrow(
      "__REDIRECT__:/onboarding",
    );

    // Le lookup users doit utiliser .ilike avec l'email verbatim
    // (pas de transformation client — c'est ilike qui gère la casse côté DB).
    expect(captured.ilikeCalls).toContainEqual({
      table: "users",
      col: "email",
      val: "Consumer@Example.COM",
    });
    // Garde-fou : pas de .eq("email", ...) sur users (sensible à la casse).
    const eqEmailUsers = captured.eqCalls.find(
      (e) => e.table === "users" && e.col === "email",
    );
    expect(eqEmailUsers).toBeUndefined();
  });

  it("idempotent : déjà producer + producer.draft existant → pas d'UPDATE roles, pas d'INSERT, pas de double audit, redirect /onboarding", async () => {
    sessionUser = { id: "user-42", email: "consumer@example.com" };
    responses.producer_invitations = [validInvitationResp("consumer@example.com")];
    responses.users = [
      {
        data: { id: "user-42", roles: ["consumer", "producer"] },
        error: null,
      },
    ];
    responses.producers = [{ data: { id: "p-1" }, error: null }];

    await expect(acceptInvitationAction({}, makeFormData())).rejects.toThrow(
      "__REDIRECT__:/onboarding",
    );

    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
    expect(logAuthEventMock).not.toHaveBeenCalled();
  });
});
