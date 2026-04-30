// Vitest pour lib/stripe/customer.ts — helper getOrCreateStripeCustomer.
//
// Couverture T-421 partiel Bundle 5 (5 cas A1-A5) + T-432 race anti-orphelin
// (4 cas R1-R4) :
//   A1 : users.stripe_customer_id existe déjà → renvoie sans créer
//   A2 : pas d'existing → customers.create + UPDATE users → renvoie nouveau id
//   A3 : SELECT users renvoie error → throw 'Failed to read user'
//   A4 : create OK + UPDATE users error → throw 'race rare' (customer Stripe
//        orphelin, signalé pour cleanup manuel)
//   A5 : prenom=null + nom=null → customers.create avec name: undefined
//        (filter Boolean dans le helper)
//   R1 : T-432 customers.create reçoit idempotencyKey customer_create_${userId}
//   R2 : T-432 UPDATE conditionnel ajoute .is('stripe_customer_id', null)
//   R3 : T-432 UPDATE 0 rows (race) → re-SELECT renvoie cus_winner → return winner
//   R4 : T-432 UPDATE 0 rows + re-SELECT null → throw race condition unrecoverable
//
// Pattern mocks aligné tests/lib/stripe/payouts.test.ts (Bundle 2 PR 2b TC).
// Extension T-432 : queue FIFO userLookupResps[] (re-SELECT post-conflit) +
// .is() chainable + UPDATE...select('id') retournant Array<row>.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `lib/stripe/customer.ts` importe 'server-only' (virtuel Next) — stub.
vi.mock("server-only", () => ({}));

const { mockCustomersCreate, mockCreateAdminClient } = vi.hoisted(() => ({
  mockCustomersCreate: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    customers: { create: mockCustomersCreate },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockCreateAdminClient,
}));

import { getOrCreateStripeCustomer } from "@/lib/stripe/customer";

// --- Supabase admin builder ----------------------------------------------

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update";

type Captured = {
  fromCalls: string[];
  updates: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let userLookupResps: Resp[]; // queue FIFO : 1er SELECT existing, puis re-SELECT post-conflit T-432
let userUpdateResp: Resp; // .data = Array<{id}> (ou null pour error path)

function makeAdminClient() {
  return {
    from(table: string) {
      captured.fromCalls.push(table);
      let pendingOp: Op = "select";
      const builder: Record<string, unknown> = {};
      builder.select = (_cols: string) => builder;
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        pendingOp = "update";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        captured.isCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve(
          userLookupResps.shift() ?? { data: null, error: null },
        );
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        Promise.resolve(
          pendingOp === "update" ? userUpdateResp : { data: null, error: null },
        ).then(onFulfilled);
      return builder;
    },
  };
}

// --- Constants -----------------------------------------------------------

const USER_ID = "user-uuid-test";
const EMAIL = "consumer@example.com";
const NEW_CUSTOMER_ID = "cus_test_new";
const EXISTING_CUSTOMER_ID = "cus_test_existing";
const WINNING_CUSTOMER_ID = "cus_winner";

// --- Setup / teardown ----------------------------------------------------

beforeEach(() => {
  captured = { fromCalls: [], updates: [], eqCalls: [], isCalls: [] };
  // Default : 1 SELECT existing miss (path nominal A2). Tests R3/R4 push une
  // 2ème entry pour le re-SELECT post-conflit.
  userLookupResps = [{ data: { stripe_customer_id: null }, error: null }];
  // Default : UPDATE 1 row affected (path nominal A2).
  userUpdateResp = { data: [{ id: USER_ID }], error: null };
  mockCustomersCreate
    .mockReset()
    .mockResolvedValue({ id: NEW_CUSTOMER_ID });
  mockCreateAdminClient.mockReset().mockImplementation(makeAdminClient);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================

describe("getOrCreateStripeCustomer — T-421 partiel", () => {
  it("A1 — users.stripe_customer_id existe → renvoie l'existant, customers.create non appelé", async () => {
    userLookupResps = [
      { data: { stripe_customer_id: EXISTING_CUSTOMER_ID }, error: null },
    ];

    const id = await getOrCreateStripeCustomer(USER_ID, EMAIL);

    expect(id).toBe(EXISTING_CUSTOMER_ID);
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
  });

  it("A2 — pas d'existing → customers.create + UPDATE users + renvoie nouveau id", async () => {
    const id = await getOrCreateStripeCustomer(
      USER_ID,
      EMAIL,
      "Alice",
      "Dupont",
    );

    expect(id).toBe(NEW_CUSTOMER_ID);
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    // T-432 : assert payload + idempotency-key.
    expect(mockCustomersCreate).toHaveBeenCalledWith(
      {
        email: EMAIL,
        name: "Alice Dupont",
        metadata: { user_id: USER_ID },
      },
      { idempotencyKey: `customer_create_${USER_ID}` },
    );
    expect(captured.updates).toEqual([
      { table: "users", payload: { stripe_customer_id: NEW_CUSTOMER_ID } },
    ]);
    // WHERE clause sur user_id pour le SELECT initial + l'UPDATE.
    const userIdEqs = captured.eqCalls.filter(
      (e) => e.table === "users" && e.col === "id" && e.val === USER_ID,
    );
    expect(userIdEqs.length).toBeGreaterThanOrEqual(2);
    // T-432 : UPDATE conditionnel ajoute .is('stripe_customer_id', null).
    expect(captured.isCalls).toContainEqual({
      table: "users",
      col: "stripe_customer_id",
      val: null,
    });
  });

  it("A3 — SELECT users error → throw 'Failed to read user'", async () => {
    userLookupResps = [{ data: null, error: { message: "RLS denied" } }];

    await expect(
      getOrCreateStripeCustomer(USER_ID, EMAIL),
    ).rejects.toThrow(/Failed to read user.*RLS denied/);

    // Pas de fallback : aucun customer Stripe créé sans confirmer le state DB.
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  it("A4 — create OK + UPDATE users error → throw 'Stripe customer created but not persisted' (race rare)", async () => {
    userUpdateResp = {
      data: null,
      error: { message: "constraint conflict" },
    };

    await expect(
      getOrCreateStripeCustomer(USER_ID, EMAIL),
    ).rejects.toThrow(
      /Stripe customer created.*cus_test_new.*not persisted.*constraint conflict/,
    );

    // Le customer Stripe a bien été créé — c'est le marqueur de la race
    // (l'orphelin Stripe est documenté + signalé par le throw).
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
  });

  it("A5 — prenom=null + nom=null → customers.create avec name: undefined", async () => {
    await getOrCreateStripeCustomer(USER_ID, EMAIL, null, null);

    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCustomersCreate.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(callArgs.email).toBe(EMAIL);
    // [null, null].filter(Boolean).join(' ').trim() === '' → || undefined.
    expect(callArgs.name).toBeUndefined();
    expect(callArgs.metadata).toEqual({ user_id: USER_ID });
  });
});

// =============================================================================

describe("R. T-432 race condition prevention", () => {
  it("R1 — customers.create reçoit idempotencyKey customer_create_${userId}", async () => {
    await getOrCreateStripeCustomer(USER_ID, EMAIL);

    expect(mockCustomersCreate).toHaveBeenCalledWith(
      expect.any(Object),
      { idempotencyKey: `customer_create_${USER_ID}` },
    );
  });

  it("R2 — UPDATE conditionnel ajoute .is('stripe_customer_id', null) (anti-race DB)", async () => {
    await getOrCreateStripeCustomer(USER_ID, EMAIL);

    expect(captured.isCalls).toContainEqual({
      table: "users",
      col: "stripe_customer_id",
      val: null,
    });
  });

  it("R3 — UPDATE 0 rows (race détectée) → re-SELECT renvoie cus_winner → return cus_winner", async () => {
    // 1ère SELECT existing = miss (default beforeEach).
    // UPDATE 0 rows = race confirmée.
    userUpdateResp = { data: [], error: null };
    // Re-SELECT post-conflit : winner persisté par le 1er call concurrent.
    userLookupResps.push({
      data: { stripe_customer_id: WINNING_CUSTOMER_ID },
      error: null,
    });

    const result = await getOrCreateStripeCustomer(USER_ID, EMAIL);

    // Return = winner (pas NEW_CUSTOMER_ID que notre call a tenté).
    expect(result).toBe(WINNING_CUSTOMER_ID);
    // customers.create appelé 1 fois (mais Stripe a renvoyé le MÊME customer
    // grâce à l'idempotency-key — testé séparément en R1, ici on valide juste
    // le path post-conflit).
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
    // 2 SELECT users au total : initial miss + re-SELECT post-conflit.
    const usersFroms = captured.fromCalls.filter((t) => t === "users");
    expect(usersFroms.length).toBe(3); // SELECT initial + UPDATE + re-SELECT
  });

  it("R4 — UPDATE 0 rows + re-SELECT null → throw 'Customer race condition unrecoverable'", async () => {
    userUpdateResp = { data: [], error: null };
    // Re-SELECT pathologique : DB retourne null malgré UPDATE 0 rows.
    userLookupResps.push({
      data: null,
      error: null,
    });

    await expect(
      getOrCreateStripeCustomer(USER_ID, EMAIL),
    ).rejects.toThrow(/Customer race condition unrecoverable/);

    expect(mockCustomersCreate).toHaveBeenCalledTimes(1);
  });
});
