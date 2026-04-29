import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

import { syncStripeDisputeUpdated } from "@/lib/stripe/handle-dispute-updated";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  updateResp?: Resp;
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

  function disputesBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
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
      onFulfilled(fixture.updateResp ?? { data: [], error: null });
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "disputes") return disputesBuilder();
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripeDisputeUpdated — mapping statuts non-terminaux", () => {
  it("under_review -> UPDATE status='under_review' + audit log", async () => {
    const { client, captured } = makeSupabase({
      updateResp: { data: [{ id: "row-1", order_id: "order-42" }], error: null },
    });

    const out = await syncStripeDisputeUpdated(makeDispute("under_review"), client);

    expect(out.result).toBe("updated");
    expect((captured.update[0] as { status: string }).status).toBe("under_review");
    expect(captured.eq).toContainEqual(["stripe_dispute_id", "dp_test_1"]);
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_dispute",
      metadata: expect.objectContaining({
        transition: "updated",
        dispute_status: "under_review",
        order_id: "order-42",
        matched: true,
      }),
    });
  });

  it("warning_needs_response -> UPDATE + audit log requires_action=true", async () => {
    const { client } = makeSupabase({
      updateResp: { data: [{ id: "row-1", order_id: "order-9" }], error: null },
    });

    await syncStripeDisputeUpdated(
      makeDispute("warning_needs_response"),
      client,
    );

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_dispute",
      metadata: expect.objectContaining({
        dispute_status: "warning_needs_response",
        requires_action: true,
      }),
    });
  });
});

describe("syncStripeDisputeUpdated — bord", () => {
  it("UPDATE matche 0 row -> result='not_found' + warn log", async () => {
    const { client } = makeSupabase({
      updateResp: { data: [], error: null },
    });
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripeDisputeUpdated(
      makeDispute("under_review"),
      client,
    );

    expect(out.result).toBe("not_found");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_DISPUTE_UPDATED_NOT_FOUND]"),
    );
  });

  it("status terminal (won) routé ici par erreur -> warn log + result='not_found'", async () => {
    const { client, captured } = makeSupabase();
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripeDisputeUpdated(makeDispute("won"), client);

    expect(out.result).toBe("not_found");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_DISPUTE_UPDATED_UNKNOWN_STATUS]"),
    );
    // Pas d'UPDATE déclenché
    expect(captured.update).toHaveLength(0);
  });
});
