import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
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
vi.mock("@/lib/resend/templates/admin-account-deauthorized", () => ({
  default: () => null,
  subject: () => "Subject mock",
}));

import { syncStripeAccountDeauthorized } from "@/lib/stripe/handle-account-deauthorized";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import { sendTemplate } from "@/lib/resend/send";

type Resp = { data?: unknown; error?: unknown };

interface Fixture {
  producerResp?: Resp;
  updateResp?: Resp;
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

  function producersBuilder() {
    const b: ChainableMockBuilder = {};
    let isUpdate = false;
    b.select = () => b;
    b.update = (payload: unknown) => {
      isUpdate = true;
      captured.update.push(payload);
      return b;
    };
    b.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return b;
    };
    b.maybeSingle = () =>
      Promise.resolve(fixture.producerResp ?? { data: null, error: null });
    b.then = (onFulfilled: (r: Resp) => unknown) => {
      if (isUpdate) {
        return onFulfilled(fixture.updateResp ?? { data: null, error: null });
      }
      return onFulfilled({ data: null, error: null });
    };
    return b;
  }

  function notificationsBuilder() {
    const b: ChainableMockBuilder = {};
    b.insert = (payload: unknown) => {
      captured.insert.push(payload);
      return Promise.resolve(fixture.notificationsResp ?? { data: null, error: null });
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "producers") return producersBuilder();
      if (table === "notifications") return notificationsBuilder();
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

const APP = { id: "ca_test_app_1", object: "application" };
const ACCOUNT = "acct_test_1";

const PRODUCER_FIXTURE = {
  data: {
    id: "producer-99",
    nom_exploitation: "Ferme du Test",
    user_id: "user-7",
  },
  error: null,
};

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

describe("syncStripeAccountDeauthorized — path nominal (deauthorized)", () => {
  it("Producer trouvé → UPDATE flags reset + statut=suspended + audit log + email URGENT", async () => {
    const { client, captured } = makeSupabase({ producerResp: PRODUCER_FIXTURE });

    const out = await syncStripeAccountDeauthorized(APP, ACCOUNT, client);

    expect(out.result).toBe("deauthorized");
    expect(out.producerId).toBe("producer-99");

    const updatePayload = captured.update[0] as Record<string, unknown>;
    expect(updatePayload).toMatchObject({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      statut: "suspended",
    });

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_account_deauthorized",
      metadata: expect.objectContaining({
        application_id: "ca_test_app_1",
        stripe_account_id: ACCOUNT,
        producer_id: "producer-99",
        producer_match: true,
      }),
    });

    // Notification placeholder DB.
    const notif = captured.insert.find(
      (p) => (p as { template?: string }).template === "admin_account_deauthorized",
    );
    expect(notif).toBeDefined();

    // Email URGENT admin via waitUntil.
    expect(mockWaitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTemplate)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        template: "admin_account_deauthorized",
      }),
    );
  });
});

describe("syncStripeAccountDeauthorized — no_producer_match", () => {
  it("eventAccount sans producer DB → audit log producer_match=false + pas de UPDATE + pas d'email", async () => {
    const { client, captured } = makeSupabase({
      producerResp: { data: null, error: null },
    });

    const out = await syncStripeAccountDeauthorized(APP, ACCOUNT, client);

    expect(out.result).toBe("no_producer_match");
    expect(out.producerId).toBeNull();
    expect(captured.update.length).toBe(0);

    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_account_deauthorized",
      metadata: expect.objectContaining({
        stripe_account_id: ACCOUNT,
        producer_match: false,
      }),
    });
    expect(mockWaitUntil).not.toHaveBeenCalled();
  });
});

describe("syncStripeAccountDeauthorized — eventAccount manquant (defensive)", () => {
  it("event.account=null → skip lookup + audit log producer_match=false", async () => {
    const { client, captured } = makeSupabase({});

    const out = await syncStripeAccountDeauthorized(APP, null, client);

    expect(out.result).toBe("no_producer_match");
    expect(captured.from).not.toContain("producers");
    expect(vi.mocked(logPaymentEvent)).toHaveBeenCalledWith({
      eventType: "stripe_account_deauthorized",
      metadata: expect.objectContaining({
        application_id: "ca_test_app_1",
        stripe_account_id: null,
        producer_match: false,
      }),
    });
  });
});
