import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// --- Hoisted env stubs --------------------------------------------------
// SUPPORT_EMAIL fail-fast au module-load (lib/env/support-email.ts) +
// NEXT_PUBLIC_APP_URL pour le layout email transitif.
vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

vi.mock("server-only", () => ({}));

// --- Mocks dépendances --------------------------------------------------
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: vi.fn().mockResolvedValue({ ok: true, id: "resend_id" }),
}));

const { mockWaitUntil } = vi.hoisted(() => ({
  mockWaitUntil: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("@/lib/resend/templates/admin-transfer-failed", () => ({
  default: () => null,
  subject: () => "Subject mock",
}));

import { syncStripeTransferFailed } from "@/lib/stripe/handle-transfer-failed";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";

// --- Supabase mock builder thenable --------------------------------------
type Resp = { data?: unknown; error?: unknown };
type Captured = {
  from: string[];
  update: unknown[];
  insert: unknown[];
  eq: Array<[string, unknown]>;
  select: string[];
  maybeSingle: number;
};

interface SupabaseFixture {
  payoutsUpdate?: Resp;
  producerLookup?: Resp;
  notificationsInsert?: Resp;
}

function makeSupabase(fixture: SupabaseFixture = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    update: [],
    insert: [],
    eq: [],
    select: [],
    maybeSingle: 0,
  };

  const payoutsUpdateResp =
    fixture.payoutsUpdate ?? {
      data: [{ id: "payout-1", producer_id: "producer-42" }],
      error: null,
    };
  const producerResp =
    fixture.producerLookup ?? {
      data: { nom_exploitation: "Ferme du Coteau" },
      error: null,
    };
  const notifResp = fixture.notificationsInsert ?? { data: null, error: null };

  function makePayoutsBuilder() {
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
    b.select = (cols: string) => {
      captured.select.push(cols);
      return b;
    };
    b.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(payoutsUpdateResp);
    return b;
  }

  function makeProducersBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = (cols: string) => {
      captured.select.push(cols);
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () => {
      captured.maybeSingle += 1;
      return Promise.resolve(producerResp);
    };
    return b;
  }

  function makeNotificationsBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.insert = (payload: unknown) => {
      captured.insert.push(payload);
      return Promise.resolve(notifResp);
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "payouts") return makePayoutsBuilder();
      if (table === "producers") return makeProducersBuilder();
      if (table === "notifications") return makeNotificationsBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

// --- Helpers --------------------------------------------------------------
function makeTransfer(
  overrides: Partial<Stripe.Transfer> & {
    failure_code?: string | null;
    failure_message?: string | null;
  } = {},
): Stripe.Transfer {
  return {
    id: "tr_test_1",
    object: "transfer",
    amount: 12345,
    currency: "eur",
    destination: "acct_test_1",
    metadata: { producer_id: "producer-42" },
    ...overrides,
  } as unknown as Stripe.Transfer;
}

beforeEach(() => {
  vi.mocked(logPaymentEvent).mockReset();
  vi.mocked(logPaymentEvent).mockResolvedValue(undefined);
  vi.mocked(sendTemplate).mockReset();
  vi.mocked(sendTemplate).mockResolvedValue({ ok: true, id: "resend_id" });
  mockWaitUntil.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncStripeTransferFailed — path nominal", () => {
  it("UPDATE payouts SET statut='failed' WHERE stripe_transfer_id=transfer.id", async () => {
    const { client, captured } = makeSupabase();
    const transfer = makeTransfer({
      failure_code: "account_closed",
      failure_message: "The bank account has been closed.",
    });

    const out = await syncStripeTransferFailed(transfer, client);

    expect(out.result).toBe("updated");
    expect(out.producerId).toBe("producer-42");
    expect(captured.from[0]).toBe("payouts");
    expect(captured.update[0]).toEqual({ statut: "failed" });
    expect(captured.eq).toContainEqual(["stripe_transfer_id", "tr_test_1"]);
  });

  it("logPaymentEvent('stripe_transfer_failed') avec metadata complète", async () => {
    const { client } = makeSupabase();
    const transfer = makeTransfer({
      failure_code: "insufficient_funds",
      failure_message: "Insufficient funds",
    });

    await syncStripeTransferFailed(transfer, client);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_transfer_failed",
      metadata: expect.objectContaining({
        transfer_id: "tr_test_1",
        producer_id: "producer-42",
        amount: 12345,
        currency: "eur",
        destination: "acct_test_1",
        failure_code: "insufficient_funds",
        failure_message: "Insufficient funds",
        matched: true,
      }),
    });
  });

  it("INSERT notifications placeholder admin (user_id=null, template='admin_transfer_failed')", async () => {
    const { client, captured } = makeSupabase();

    await syncStripeTransferFailed(makeTransfer(), client);

    expect(captured.from).toContain("notifications");
    const notifInsert = captured.insert.find(
      (p) => (p as { template?: string }).template === "admin_transfer_failed",
    ) as { user_id: string | null; type: string; statut: string };
    expect(notifInsert).toBeDefined();
    expect(notifInsert.user_id).toBeNull();
    expect(notifInsert.type).toBe("email");
    expect(notifInsert.statut).toBe("sent");
  });

  it("waitUntil(sendTemplate(...)) appelé avec to=SUPPORT_EMAIL", async () => {
    const { client } = makeSupabase();

    await syncStripeTransferFailed(makeTransfer(), client);

    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        userId: null,
        template: "admin_transfer_failed",
      }),
    );
  });
});

describe("syncStripeTransferFailed — no_match (stripe_transfer_id introuvable)", () => {
  it("UPDATE retourne 0 row -> result='no_match' + warn log greppable", async () => {
    const { client } = makeSupabase({
      payoutsUpdate: { data: [], error: null },
    });
    const warn = vi.spyOn(console, "warn");

    const out = await syncStripeTransferFailed(makeTransfer(), client);

    expect(out.result).toBe("no_match");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_TRANSFER_FAILED_NO_MATCH]"),
    );
  });

  it("no_match : producer_id fallback metadata Stripe + audit log + email envoyé quand même", async () => {
    const { client } = makeSupabase({
      payoutsUpdate: { data: [], error: null },
    });

    const transfer = makeTransfer({
      metadata: { producer_id: "producer-from-metadata" },
    });

    const out = await syncStripeTransferFailed(transfer, client);

    expect(out.producerId).toBe("producer-from-metadata");
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_transfer_failed",
        metadata: expect.objectContaining({ matched: false }),
      }),
    );
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
  });
});
