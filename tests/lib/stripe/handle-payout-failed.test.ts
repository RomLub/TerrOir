import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "resend_id" }),
}));

const { mockWaitUntil } = vi.hoisted(() => ({ mockWaitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mockWaitUntil }));

vi.mock("@/lib/resend/templates/admin-payout-failed", () => ({
  default: () => null,
  subject: () => "Subject mock",
}));

import { syncStripePayoutFailed } from "@/lib/stripe/handle-payout-failed";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";

// --- Supabase fixture-driven mock --------------------------------------------
type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  // Lookup direct via metadata.payout_id : payouts.eq('id', X).maybeSingle()
  payoutByIdResp?: Resp;
  // Lookup producer via stripe_account_id : producers.eq(...).maybeSingle()
  producerByAccountResp?: Resp;
  // Lookup match payouts récents : chained eq/in/gte/order/limit/maybeSingle
  payoutByProducerResp?: Resp;
  // UPDATE payouts.eq('id', X) returning thenable
  payoutsUpdateResp?: Resp;
  // Lookup nom_exploitation final
  producerByIdResp?: Resp;
  // INSERT notifications
  notificationsResp?: Resp;
}

type Captured = {
  from: string[];
  insert: unknown[];
  update: unknown[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(fixture: Fixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], insert: [], update: [], eq: [] };

  function payoutsBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    let isUpdate = false;
    let inCalled = false; // marqueur lookup by producer (chain .in('statut',...))
    b.update = (payload: unknown) => {
      isUpdate = true;
      captured.update.push(payload);
      return b;
    };
    b.select = () => b;
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
      // .in() = lookup by producer, sinon = lookup direct via metadata.payout_id
      if (inCalled) {
        return Promise.resolve(
          fixture.payoutByProducerResp ?? { data: null, error: null },
        );
      }
      return Promise.resolve(fixture.payoutByIdResp ?? { data: null, error: null });
    };
    b.then = (onFulfilled: (r: Resp) => unknown) => {
      if (isUpdate) {
        return onFulfilled(fixture.payoutsUpdateResp ?? { data: null, error: null });
      }
      return onFulfilled({ data: null, error: null });
    };
    return b;
  }

  function producersBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    let lookupKey: string | null = null;
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      lookupKey = col;
      return b;
    };
    b.maybeSingle = () => {
      if (lookupKey === "stripe_account_id") {
        return Promise.resolve(
          fixture.producerByAccountResp ?? { data: null, error: null },
        );
      }
      // lookup by id (final name lookup)
      return Promise.resolve(fixture.producerByIdResp ?? { data: null, error: null });
    };
    return b;
  }

  function notificationsBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.insert = (payload: unknown) => {
      captured.insert.push(payload);
      return Promise.resolve(fixture.notificationsResp ?? { data: null, error: null });
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "payouts") return payoutsBuilder();
      if (table === "producers") return producersBuilder();
      if (table === "notifications") return notificationsBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

// --- Helpers ------------------------------------------------------------------
function makePayout(overrides: Partial<Stripe.Payout> = {}): Stripe.Payout {
  return {
    id: "po_test_1",
    object: "payout",
    amount: 5000,
    currency: "eur",
    arrival_date: 1700000000,
    destination: "ba_test_1",
    failure_code: "account_closed",
    failure_message: "The bank account has been closed.",
    metadata: {},
    ...overrides,
  } as unknown as Stripe.Payout;
}

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendTemplate).mockReset().mockResolvedValue({ ok: true, id: "resend_id" });
  mockWaitUntil.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripePayoutFailed — direct via metadata.payout_id (T-414 futur)", () => {
  it("UPDATE statut='failed' direct sur le row, result='updated'", async () => {
    const { client, captured } = makeSupabase({
      payoutByIdResp: {
        data: { id: "row-payout-1", producer_id: "producer-42" },
        error: null,
      },
      producerByIdResp: {
        data: { nom_exploitation: "Ferme du Coteau" },
        error: null,
      },
    });
    const payout = makePayout({
      metadata: { payout_id: "row-payout-1" } as Stripe.Metadata,
    });

    const out = await syncStripePayoutFailed(payout, "acct_test", client);

    expect(out.result).toBe("updated");
    expect(out.payoutRowId).toBe("row-payout-1");
    expect(out.producerId).toBe("producer-42");
    expect(captured.update[0]).toEqual({ statut: "failed" });
  });
});

describe("syncStripePayoutFailed — fallback event.account → producer match", () => {
  it("metadata.payout_id absent + producer found via stripe_account_id + payout récent matché", async () => {
    const { client } = makeSupabase({
      payoutByIdResp: { data: null, error: null }, // pas trouvé via metadata
      producerByAccountResp: {
        data: { id: "producer-42" },
        error: null,
      },
      payoutByProducerResp: {
        data: { id: "row-payout-99", producer_id: "producer-42" },
        error: null,
      },
      producerByIdResp: {
        data: { nom_exploitation: "Ferme Bio" },
        error: null,
      },
    });

    const out = await syncStripePayoutFailed(makePayout(), "acct_test", client);

    expect(out.result).toBe("updated");
    expect(out.payoutRowId).toBe("row-payout-99");
    expect(out.producerId).toBe("producer-42");
  });

  it("fallback no match (producer trouvé mais 0 payout récent) → result='no_match' + warn log", async () => {
    const { client } = makeSupabase({
      producerByAccountResp: { data: { id: "producer-42" }, error: null },
      payoutByProducerResp: { data: null, error: null },
    });
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripePayoutFailed(makePayout(), "acct_test", client);

    expect(out.result).toBe("no_match");
    expect(out.payoutRowId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_PAYOUT_FAILED_NO_MATCH]"),
    );
  });

  it("fallback no producer (event.account orphelin DB) → result='no_match'", async () => {
    const { client } = makeSupabase({
      producerByAccountResp: { data: null, error: null },
    });

    const out = await syncStripePayoutFailed(makePayout(), "acct_orphan", client);

    expect(out.result).toBe("no_match");
    expect(out.producerId).toBeNull();
  });
});

describe("syncStripePayoutFailed — observabilité (audit + notification + email)", () => {
  it("logPaymentEvent('stripe_payout_failed') avec metadata complète + matched=true", async () => {
    const { client } = makeSupabase({
      payoutByIdResp: {
        data: { id: "row-1", producer_id: "producer-42" },
        error: null,
      },
      producerByIdResp: {
        data: { nom_exploitation: "Ferme X" },
        error: null,
      },
    });
    const payout = makePayout({
      metadata: { payout_id: "row-1" } as Stripe.Metadata,
    });

    await syncStripePayoutFailed(payout, "acct_test", client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_payout_failed",
      metadata: expect.objectContaining({
        payout_id: "po_test_1",
        payout_row_id: "row-1",
        producer_id: "producer-42",
        amount: 5000,
        currency: "eur",
        failure_code: "account_closed",
        matched: true,
      }),
    });
  });

  it("INSERT notifications placeholder + waitUntil(sendTemplate(... to=SUPPORT_EMAIL))", async () => {
    const { client, captured } = makeSupabase({
      payoutByIdResp: {
        data: { id: "row-1", producer_id: "producer-42" },
        error: null,
      },
      producerByIdResp: {
        data: { nom_exploitation: "Ferme X" },
        error: null,
      },
    });
    const payout = makePayout({
      metadata: { payout_id: "row-1" } as Stripe.Metadata,
    });

    await syncStripePayoutFailed(payout, "acct_test", client);

    const notif = captured.insert.find(
      (p) => (p as { template?: string }).template === "admin_payout_failed",
    );
    expect(notif).toBeDefined();

    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        userId: null,
        template: "admin_payout_failed",
      }),
    );
  });
});
