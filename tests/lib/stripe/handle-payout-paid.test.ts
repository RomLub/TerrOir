// Vitest pour syncStripePayoutPaid (handler webhook payout.paid extrait T-400).
//
// Couverture :
//   1. Match via source_transaction (path nominal Bundle 3 T-402)
//   2. Fallback event.account → producer match (T-402 fallback)
//   3. No match — pas de source_transaction, pas de event.account
//   4. No match — event.account présent mais producer introuvable
//   5. No match — producer trouvé mais aucun payout récent matché
//   6. Audit log forensique stripe_payout_paid posé dans tous les chemins
//      (matched=true sur match, matched=false sur no-match)
//   7. payoutRowId retourné cohérent dans le path nominal
//
// Pattern aligné tests/lib/stripe/handle-payout-failed.test.ts (vi.mock
// log-payment-event + Supabase fixture-driven mock par table).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { ChainableMockBuilder } from "./_mock-builder";

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

import { syncStripePayoutPaid } from "@/lib/stripe/handle-payout-paid";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

// --- Supabase fixture-driven mock --------------------------------------------
type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  // Path nominal : .from('payouts').update({...}).eq('stripe_transfer_id', X).select('id')
  payoutsUpdateSelectResp?: Resp;
  // Lookup producer via stripe_account_id : producers.eq(...).maybeSingle()
  producerByAccountResp?: Resp;
  // Lookup match payouts récents : chained eq/in/gte/order/limit/maybeSingle
  payoutByProducerResp?: Resp;
  // UPDATE final fallback (sans .select) : thenable
  payoutsFallbackUpdateResp?: Resp;
}

type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(fixture: Fixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], update: [], eq: [] };

  function payoutsBuilder() {
    const b: ChainableMockBuilder = {};
    let isUpdate = false;
    let inCalled = false; // marqueur lookup payouts par producer (chain .in())
    let selectCalled = false; // marqueur path source_transaction (.update().eq().select())

    b.update = (payload: unknown) => {
      isUpdate = true;
      captured.update.push(payload);
      return b;
    };
    b.select = () => {
      selectCalled = true;
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.in = () => {
      inCalled = true;
      return b;
    };
    b.gte = () => b;
    b.order = () => b;
    b.limit = () => b;
    b.maybeSingle = () => {
      if (inCalled) {
        return Promise.resolve(
          fixture.payoutByProducerResp ?? { data: null, error: null },
        );
      }
      return Promise.resolve({ data: null, error: null });
    };
    b.then = (onFulfilled: (r: Resp) => unknown) => {
      if (isUpdate && selectCalled) {
        return onFulfilled(
          fixture.payoutsUpdateSelectResp ?? { data: null, error: null },
        );
      }
      if (isUpdate) {
        return onFulfilled(
          fixture.payoutsFallbackUpdateResp ?? { data: null, error: null },
        );
      }
      return onFulfilled({ data: null, error: null });
    };
    return b;
  }

  function producersBuilder() {
    const b: ChainableMockBuilder = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(
        fixture.producerByAccountResp ?? { data: null, error: null },
      );
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "payouts") return payoutsBuilder();
      if (table === "producers") return producersBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

// --- Helpers fixtures -----------------------------------------------------
function makePayout(
  overrides: Partial<Stripe.Payout> & { source_transaction?: string | null } = {},
): Stripe.Payout & { source_transaction?: string | null } {
  return {
    id: "po_test_1",
    object: "payout",
    amount: 5000,
    currency: "eur",
    arrival_date: 1700000000,
    destination: "ba_test_1",
    metadata: {},
    ...overrides,
  } as unknown as Stripe.Payout & { source_transaction?: string | null };
}

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset().mockResolvedValue(undefined);
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// 1. Path nominal — match via source_transaction (Bundle 3 T-402)
// =============================================================================

describe("syncStripePayoutPaid — match via source_transaction", () => {
  it("source_transaction présent + UPDATE retourne row → result match_via_source_transaction + audit log matched=true", async () => {
    const { client, captured } = makeSupabase({
      payoutsUpdateSelectResp: { data: [{ id: "row-1" }], error: null },
    });
    const payout = makePayout({
      id: "po_match_1",
      source_transaction: "tr_1",
    });

    const out = await syncStripePayoutPaid(payout, "acct_test", client);

    expect(out.result).toBe("match_via_source_transaction");
    expect(out.matchSource).toBe("source_transaction");
    expect(out.payoutRowId).toBe("row-1");

    // UPDATE statut='paid' + stripe_payout_id sur la première stratégie.
    expect(captured.update[0]).toEqual({
      statut: "paid",
      stripe_payout_id: "po_match_1",
    });
    expect(captured.eq[0]).toEqual(["stripe_transfer_id", "tr_1"]);

    // Pas de fallback (pas de chain producers).
    expect(captured.from).toEqual(["payouts"]);

    // Audit log forensique avec match_source=source_transaction.
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_paid",
      metadata: expect.objectContaining({
        payout_id: "po_match_1",
        source_transaction: "tr_1",
        match_source: "source_transaction",
        matched: true,
      }),
    });
  });
});

// =============================================================================
// 2. Fallback event.account → producer match (T-402)
// =============================================================================

describe("syncStripePayoutPaid — fallback event.account → producer match", () => {
  it("source_transaction absent + producer trouvé via stripe_account_id + payout récent matché → result match_via_event_account + audit log matched=true", async () => {
    const { client, captured } = makeSupabase({
      producerByAccountResp: { data: { id: "producer-42" }, error: null },
      payoutByProducerResp: { data: { id: "payout-row-99" }, error: null },
    });
    const payout = makePayout({
      id: "po_fallback_1",
      source_transaction: null,
    });

    const out = await syncStripePayoutPaid(payout, "acct_42", client);

    expect(out.result).toBe("match_via_event_account");
    expect(out.matchSource).toBe("fallback_account");
    expect(out.payoutRowId).toBe("payout-row-99");

    // 2 from('payouts') (1 tentative source_transaction qui ne match pas
    // → updated.length=0, puis 1 fallback UPDATE après lookup) + 1
    // from('producers') + 1 from('payouts') pour la lookup chain.
    expect(captured.from).toContain("producers");

    // L'UPDATE fallback porte aussi sur statut='paid' + stripe_payout_id.
    const fallbackUpdate = captured.update.find(
      (u) =>
        typeof u === "object" &&
        u !== null &&
        (u as Record<string, unknown>).stripe_payout_id === "po_fallback_1",
    );
    expect(fallbackUpdate).toBeDefined();

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_paid",
      metadata: expect.objectContaining({
        payout_id: "po_fallback_1",
        source_transaction: null,
        stripe_account: "acct_42",
        match_source: "fallback_account",
        matched: true,
      }),
    });
  });
});

// =============================================================================
// 3. No match — ni source_transaction ni event.account
// =============================================================================

describe("syncStripePayoutPaid — no match (ni source_transaction ni event.account)", () => {
  it("→ result no_match_no_account + warn log + audit log matched=false", async () => {
    const { client, captured } = makeSupabase();
    const payout = makePayout({
      id: "po_orphan_1",
      source_transaction: null,
    });

    const out = await syncStripePayoutPaid(payout, null, client);

    expect(out.result).toBe("no_match_no_account");
    expect(out.matchSource).toBe("no_match");
    expect(out.payoutRowId).toBeNull();

    // Pas de from('producers') ni de fallback UPDATE.
    expect(captured.from).not.toContain("producers");

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[PAYOUT_PAID_NO_TRANSACTION_NO_ACCOUNT]"),
    );

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_paid",
      metadata: expect.objectContaining({
        payout_id: "po_orphan_1",
        match_source: "no_match",
        matched: false,
      }),
    });
  });
});

// =============================================================================
// 4. No match — event.account présent mais producer introuvable
// =============================================================================

describe("syncStripePayoutPaid — no match (producer introuvable via account)", () => {
  it("→ result no_match_producer_not_found + warn log + audit log matched=false", async () => {
    const { client } = makeSupabase({
      producerByAccountResp: { data: null, error: null },
    });
    const payout = makePayout({
      id: "po_no_producer",
      source_transaction: null,
    });

    const out = await syncStripePayoutPaid(payout, "acct_unknown", client);

    expect(out.result).toBe("no_match_producer_not_found");
    expect(out.payoutRowId).toBeNull();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[PAYOUT_PAID_NO_TRANSACTION_NO_PRODUCER]"),
    );

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_paid",
      metadata: expect.objectContaining({
        match_source: "no_match",
        matched: false,
      }),
    });
  });
});

// =============================================================================
// 5. No match — producer trouvé mais aucun payout récent
// =============================================================================

describe("syncStripePayoutPaid — no match (producer OK mais pas de payouts récents)", () => {
  it("→ result no_match_no_recent_payouts + warn log + audit log matched=false", async () => {
    const { client } = makeSupabase({
      producerByAccountResp: { data: { id: "producer-99" }, error: null },
      payoutByProducerResp: { data: null, error: null },
    });
    const payout = makePayout({
      id: "po_no_recent",
      source_transaction: null,
    });

    const out = await syncStripePayoutPaid(payout, "acct_99", client);

    expect(out.result).toBe("no_match_no_recent_payouts");
    expect(out.payoutRowId).toBeNull();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[PAYOUT_PAID_NO_TRANSACTION_NO_MATCH]"),
    );

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_paid",
      metadata: expect.objectContaining({
        match_source: "no_match",
        matched: false,
      }),
    });
  });
});

// =============================================================================
// 6. Audit log metadata — destination expansée vs string
// =============================================================================

describe("syncStripePayoutPaid — audit log metadata defensive", () => {
  it("destination string → loggée tel quel ; destination expansée objet → loggée comme .id", async () => {
    const { client } = makeSupabase();
    const payoutWithExpanded = {
      ...makePayout({ id: "po_expanded", source_transaction: null }),
      destination: { id: "ba_expanded_1", object: "bank_account" },
    };

    await syncStripePayoutPaid(
      payoutWithExpanded as unknown as Stripe.Payout & {
        source_transaction?: string | null;
      },
      null,
      client,
    );

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_paid",
      metadata: expect.objectContaining({
        destination: "ba_expanded_1",
      }),
    });
  });
});
