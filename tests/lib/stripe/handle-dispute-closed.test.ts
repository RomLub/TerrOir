import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { ChainableMockBuilder } from "./_mock-builder";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "resend_id" }),
}));
const { mockWaitUntil } = vi.hoisted(() => ({ mockWaitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: mockWaitUntil }));
vi.mock("@/lib/resend/templates/admin-dispute-closed", () => ({
  default: () => null,
  subject: () => "Subject mock",
}));

import { syncStripeDisputeClosed } from "@/lib/stripe/handle-dispute-closed";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";

type Resp = { data?: unknown; error?: unknown };
interface Fixture {
  disputesUpdateResp?: Resp;
  ordersResp?: Resp;
  notifResp?: Resp;
}
type Captured = {
  from: string[];
  update: unknown[];
  insert: unknown[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(fixture: Fixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = { from: [], update: [], insert: [], eq: [] };

  function disputesBuilder() {
    const b: ChainableMockBuilder = {};
    b.update = (payload: unknown) => {
      captured.update.push(payload);
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.select = () => b;
    b.then = (onFulfilled: (r: Resp) => unknown) =>
      onFulfilled(fixture.disputesUpdateResp ?? { data: [], error: null });
    return b;
  }

  function ordersBuilder() {
    const b: ChainableMockBuilder = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(fixture.ordersResp ?? { data: null, error: null });
    return b;
  }

  function notificationsBuilder() {
    const b: ChainableMockBuilder = {};
    b.insert = (payload: unknown) => {
      captured.insert.push(payload);
      return Promise.resolve(fixture.notifResp ?? { data: null, error: null });
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "disputes") return disputesBuilder();
      if (table === "orders") return ordersBuilder();
      if (table === "notifications") return notificationsBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeDispute(
  status: Stripe.Dispute.Status,
  overrides: Partial<Stripe.Dispute> = {},
): Stripe.Dispute {
  return {
    id: "dp_test_1",
    object: "dispute",
    status,
    amount: 5000,
    currency: "eur",
    reason: "fraudulent",
    ...overrides,
  } as unknown as Stripe.Dispute;
}

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendTemplate).mockReset().mockResolvedValue({ ok: true, id: "resend_id" });
  mockWaitUntil.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripeDisputeClosed — outcomes terminaux", () => {
  it("won -> UPDATE status='won' + closed_at + audit + email", async () => {
    const { client, captured } = makeSupabase({
      disputesUpdateResp: {
        data: [
          {
            id: "row-1",
            order_id: "order-42",
            amount: 50,
            currency: "eur",
            reason: "fraudulent",
          },
        ],
        error: null,
      },
      ordersResp: { data: { code_commande: "TER-2026-0042" }, error: null },
    });

    const out = await syncStripeDisputeClosed(makeDispute("won"), client);

    expect(out.result).toBe("closed");
    expect(out.orderId).toBe("order-42");
    const upd = captured.update[0] as { status: string; closed_at: string };
    expect(upd.status).toBe("won");
    expect(upd.closed_at).toBeTruthy();

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_dispute",
      metadata: expect.objectContaining({
        transition: "closed",
        dispute_status: "won",
        matched: true,
      }),
    });
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });

  it("lost -> UPDATE status='lost' + notification placeholder + email", async () => {
    const { client, captured } = makeSupabase({
      disputesUpdateResp: {
        data: [
          {
            id: "row-2",
            order_id: "order-9",
            amount: 30,
            currency: "eur",
            reason: "duplicate",
          },
        ],
        error: null,
      },
      ordersResp: { data: { code_commande: "TER-X" }, error: null },
    });

    const out = await syncStripeDisputeClosed(makeDispute("lost"), client);

    expect(out.result).toBe("closed");
    const upd = captured.update[0] as { status: string };
    expect(upd.status).toBe("lost");
    const notif = captured.insert.find(
      (p) => (p as { template?: string }).template === "admin_dispute_closed",
    );
    expect(notif).toBeDefined();
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        template: "admin_dispute_closed",
      }),
    );
  });

  it("warning_closed -> UPDATE status='warning_closed' (Visa CE3.0)", async () => {
    const { client, captured } = makeSupabase({
      disputesUpdateResp: {
        data: [
          {
            id: "row-3",
            order_id: "order-1",
            amount: 10,
            currency: "eur",
            reason: null,
          },
        ],
        error: null,
      },
      ordersResp: { data: { code_commande: "TER-Y" }, error: null },
    });

    const out = await syncStripeDisputeClosed(
      makeDispute("warning_closed"),
      client,
    );

    expect(out.result).toBe("closed");
    expect((captured.update[0] as { status: string }).status).toBe(
      "warning_closed",
    );
  });
});

describe("syncStripeDisputeClosed — bord", () => {
  it("status non-terminal (under_review) routé ici par erreur -> warn log + 'not_found'", async () => {
    const { client, captured } = makeSupabase();
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripeDisputeClosed(
      makeDispute("under_review"),
      client,
    );

    expect(out.result).toBe("not_found");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_DISPUTE_CLOSED_NON_TERMINAL]"),
    );
    expect(captured.update).toHaveLength(0);
  });

  it("UPDATE matche 0 row -> result='not_found' + warn log", async () => {
    const { client } = makeSupabase({
      disputesUpdateResp: { data: [], error: null },
    });
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripeDisputeClosed(makeDispute("won"), client);

    expect(out.result).toBe("not_found");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_DISPUTE_CLOSED_NOT_FOUND]"),
    );
  });
});
