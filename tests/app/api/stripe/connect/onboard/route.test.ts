// Vitest pour POST /api/stripe/connect/onboard.
//
// Couverture :
//   - Path nominal (création account + UPDATE OK + accountLinks)
//   - Path déjà account (skip création)
//   - Path 403 session absente / non-producer
//   - Path 404 producer not found
//   - Path compensation T-418 (UPDATE throw → accounts.del appelé)
//   - Path borderline T-418 (accounts.del throw → log greppable + continuer)
//
// Pattern aligné tests/app/api/stripe/refund/route.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_PRODUCER_URL ne sont pas définis. Hoist le stub avant
// les imports static (pattern aligné connexion/actions.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

const {
  mockAccountsCreate,
  mockAccountsDel,
  mockAccountLinksCreate,
} = vi.hoisted(() => ({
  mockAccountsCreate: vi.fn(),
  mockAccountsDel: vi.fn(),
  mockAccountLinksCreate: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    accounts: {
      create: mockAccountsCreate,
      del: mockAccountsDel,
    },
    accountLinks: {
      create: mockAccountLinksCreate,
    },
  },
}));

// --- Auth mock ------------------------------------------------------------

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// --- Supabase admin mock --------------------------------------------------

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update";

type Captured = {
  fromCalls: string[];
  updates: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let producerLookupResp: Resp;
let producerUpdateResp: Resp;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      captured.fromCalls.push(table);
      let pendingOp: Op = "select";
      const builder: any = {
        select(_cols: string) {
          return builder;
        },
        update(payload: unknown) {
          captured.updates.push({ table, payload });
          pendingOp = "update";
          return builder;
        },
        eq(col: string, val: unknown) {
          captured.eqCalls.push({ table, col, val });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(producerLookupResp);
        },
        then(onFulfilled: (r: Resp) => unknown) {
          const resp = pendingOp === "update" ? producerUpdateResp : { data: null, error: null };
          return Promise.resolve(resp).then(onFulfilled);
        },
      };
      return builder;
    },
  }),
}));

// --- Import APRÈS les mocks -----------------------------------------------

import { POST } from "@/app/api/stripe/connect/onboard/route";

// --- Helpers --------------------------------------------------------------

const PRODUCER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function defaultSession(): SessionUser {
  return {
    id: USER_ID,
    email: "producer@example.com",
    roles: ["producer"],
    isAdmin: false,
  };
}

// --- Setup / teardown -----------------------------------------------------

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], updates: [], eqCalls: [] };
  sessionUser = defaultSession();
  producerLookupResp = {
    data: { id: PRODUCER_ID, stripe_account_id: null },
    error: null,
  };
  producerUpdateResp = { data: null, error: null };
  mockAccountsCreate.mockReset().mockResolvedValue({ id: "acct_new_test" });
  mockAccountsDel.mockReset().mockResolvedValue({ id: "acct_new_test", deleted: true });
  mockAccountLinksCreate
    .mockReset()
    .mockResolvedValue({ url: "https://connect.stripe.com/setup/acct_new_test" });
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// 1. Path nominal — création account + UPDATE OK + accountLinks
// =============================================================================

describe("POST /api/stripe/connect/onboard — path nominal", () => {
  it("producer sans stripe_account_id → accounts.create + UPDATE + accountLinks → JSON {url, account_id}", async () => {
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      url: "https://connect.stripe.com/setup/acct_new_test",
      account_id: "acct_new_test",
    });

    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(captured.updates).toEqual([
      { table: "producers", payload: { stripe_account_id: "acct_new_test" } },
    ]);
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_new_test", type: "account_onboarding" }),
    );
    // Pas de del en path nominal.
    expect(mockAccountsDel).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 1'. Audit Stripe H-2 — controller properties remplacent legacy type:"express"
// =============================================================================
//
// Phase 2 H-2 (2026-05-05) — preuve de non-régression côté payload Stripe :
// le code ne passe plus le legacy `type` parameter (strap-to-avoid skill
// stripe-best-practices/connect.md:14) et passe les 4 controller properties
// explicites équivalentes au comportement Express.

describe("POST /api/stripe/connect/onboard — H-2 controller properties", () => {
  it("H-2-A accounts.create reçoit les 4 controller properties Express-equivalent", async () => {
    await POST();

    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    const payload = mockAccountsCreate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    // 4 controller properties exactes (mapping Express documenté
    // docs/audits/audit-stripe-h2-connect-v2-2026-05-05.md §1).
    expect(payload.controller).toEqual({
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "stripe",
      stripe_dashboard: { type: "express" },
    });

    // Capabilities + country + email préservés (regression guard).
    expect(payload.country).toBe("FR");
    expect(payload.email).toBe("producer@example.com");
    expect(payload.capabilities).toEqual({
      card_payments: { requested: true },
      transfers: { requested: true },
    });
  });

  it("H-2-B accounts.create ne passe PLUS le legacy `type` parameter", async () => {
    await POST();

    const payload = mockAccountsCreate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    // Strap-to-avoid skill connect.md:14 : "Don't use the legacy `type`
    // parameter (`type: 'express'`, ...) in POST /v1/accounts for new
    // platforms". Validation directe : la propriété ne doit pas exister.
    expect(payload.type).toBeUndefined();
  });
});

// =============================================================================
// 2. Path déjà account — skip création, accountLinks direct
// =============================================================================

describe("POST /api/stripe/connect/onboard — déjà stripe_account_id", () => {
  it("producer avec stripe_account_id existant → skip accounts.create, accountLinks direct", async () => {
    producerLookupResp = {
      data: { id: PRODUCER_ID, stripe_account_id: "acct_already_existing" },
      error: null,
    };

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account_id).toBe("acct_already_existing");

    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]); // pas d'UPDATE non plus
    expect(mockAccountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_already_existing" }),
    );
  });
});

// =============================================================================
// 3. Path session 403
// =============================================================================

describe("POST /api/stripe/connect/onboard — auth", () => {
  it("session absente → 403 Forbidden", async () => {
    sessionUser = null;
    const res = await POST();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it("session non-producer / non-admin → 403 Forbidden", async () => {
    sessionUser = {
      id: USER_ID,
      email: "consumer@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it("session admin (sans rôle producer) → autorisé", async () => {
    sessionUser = {
      id: USER_ID,
      email: "admin@example.com",
      roles: [],
      isAdmin: true,
    };
    const res = await POST();
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// 4. Path producer not found
// =============================================================================

describe("POST /api/stripe/connect/onboard — producer not found", () => {
  it("aucune row producers WHERE user_id=session.id → 404", async () => {
    producerLookupResp = { data: null, error: null };
    const res = await POST();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Producer profile not found" });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 5. Compensation T-418 — UPDATE DB throw → accounts.del appelé
// =============================================================================

describe("POST /api/stripe/connect/onboard — compensation T-418", () => {
  it("UPDATE producers échoue → accounts.del(stripeAccountId) appelé + 500", async () => {
    producerUpdateResp = {
      data: null,
      error: { message: "RLS policy violation" },
    };

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("Account created but not persisted");
    expect(body.error).toContain("RLS policy violation");

    // accounts.del appelé en compensation pour éviter l'orphelin Stripe.
    expect(mockAccountsDel).toHaveBeenCalledTimes(1);
    expect(mockAccountsDel).toHaveBeenCalledWith("acct_new_test");

    // Pas de log [ROLLBACK_FAILED] en path nominal de compensation (del a réussi).
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("UPDATE échoue + accounts.del throw → log [CONNECT_ONBOARD_ROLLBACK_FAILED] + 500 (pas re-throw)", async () => {
    producerUpdateResp = {
      data: null,
      error: { message: "connection lost" },
    };
    mockAccountsDel.mockRejectedValueOnce(
      new Error("Account has activity, cannot be deleted"),
    );

    const res = await POST();

    expect(res.status).toBe(500);
    expect(mockAccountsDel).toHaveBeenCalledTimes(1);

    // Log greppable pour intervention admin manuelle.
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[CONNECT_ONBOARD_ROLLBACK_FAILED]");
    expect(warned).toContain("account=acct_new_test");
    expect(warned).toContain(`producer=${PRODUCER_ID}`);
    expect(warned).toContain("Account has activity");
  });
});
