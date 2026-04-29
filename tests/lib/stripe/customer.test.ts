// Vitest pour lib/stripe/customer.ts — helper getOrCreateStripeCustomer.
//
// Couverture T-421 partiel Bundle 5 — 5 cas :
//   A1 : users.stripe_customer_id existe déjà → renvoie sans créer
//   A2 : pas d'existing → customers.create + UPDATE users → renvoie nouveau id
//   A3 : SELECT users renvoie error → throw 'Failed to read user'
//   A4 : create OK + UPDATE users error → throw 'race rare' (customer Stripe
//        orphelin, signalé pour cleanup manuel)
//   A5 : prenom=null + nom=null → customers.create avec name: undefined
//        (filter Boolean dans le helper)
//
// Pattern mocks aligné tests/lib/stripe/payouts.test.ts (Bundle 2 PR 2b TC).

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
};

let captured: Captured;
let userLookupResp: Resp;
let userUpdateResp: Resp;

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
      builder.maybeSingle = () => Promise.resolve(userLookupResp);
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

// --- Setup / teardown ----------------------------------------------------

beforeEach(() => {
  captured = { fromCalls: [], updates: [], eqCalls: [] };
  userLookupResp = { data: { stripe_customer_id: null }, error: null };
  userUpdateResp = { data: null, error: null };
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
    userLookupResp = {
      data: { stripe_customer_id: EXISTING_CUSTOMER_ID },
      error: null,
    };

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
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: EMAIL,
      name: "Alice Dupont",
      metadata: { user_id: USER_ID },
    });
    expect(captured.updates).toEqual([
      { table: "users", payload: { stripe_customer_id: NEW_CUSTOMER_ID } },
    ]);
    // WHERE clause sur user_id pour le SELECT initial + l'UPDATE.
    const userIdEqs = captured.eqCalls.filter(
      (e) => e.table === "users" && e.col === "id" && e.val === USER_ID,
    );
    expect(userIdEqs.length).toBeGreaterThanOrEqual(2);
  });

  it("A3 — SELECT users error → throw 'Failed to read user'", async () => {
    userLookupResp = { data: null, error: { message: "RLS denied" } };

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
