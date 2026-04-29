// Vitest pour POST /api/stripe/webhook — couverture dédup applicative
// (T-103, mini-chantier 2026-04-29). Focus : vérifier que checkOrMarkProcessed
// est appelé pour les 4 events DEDUP_TARGETS, qu'un alreadyProcessed=true
// court-circuite l'orchestration, et que les events hors targets ne polluent
// pas la table.
//
// Pattern hoisted env + module-level vi.mock aligné sur
// tests/app/api/admin/producers/invite/route.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// --- Hoisted env stubs ---------------------------------------------------
// lib/env/urls (chargé transitivement via la route) throw au module-load
// si NEXT_PUBLIC_APP_URL ou NEXT_PUBLIC_PRODUCER_URL manquent.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
  process.env.STRIPE_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test";
});

vi.mock("server-only", () => ({}));

// --- Hoisted mocks pour les dépendances -----------------------------------
const {
  mockConstructEvent,
  mockCheckOrMarkProcessed,
  mockSyncSucceeded,
  mockSyncFailed,
  mockSyncAccountFlags,
  mockCreateAdmin,
  mockSendTemplate,
  mockSendSms,
  mockWaitUntil,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockCheckOrMarkProcessed: vi.fn(),
  mockSyncSucceeded: vi.fn(),
  mockSyncFailed: vi.fn(),
  mockSyncAccountFlags: vi.fn(),
  mockCreateAdmin: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockSendSms: vi.fn(),
  mockWaitUntil: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    refunds: { create: vi.fn() },
  },
}));

vi.mock("@/lib/webhook-events/check-or-mark-processed", () => ({
  checkOrMarkProcessed: mockCheckOrMarkProcessed,
}));

vi.mock("@/lib/stripe/handle-payment-succeeded", () => ({
  syncStripePaymentSucceeded: mockSyncSucceeded,
}));

vi.mock("@/lib/stripe/handle-payment-failed", () => ({
  syncStripePaymentFailed: mockSyncFailed,
}));

vi.mock("@/lib/stripe/sync-account-flags", () => ({
  syncStripeAccountFlags: mockSyncAccountFlags,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockCreateAdmin,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@/lib/twilio/sms", () => ({
  sendNewOrderProducerSms: mockSendSms,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: mockWaitUntil,
}));

// React templates : la route les passe à sendTemplate (mocké), donc
// les composants ne sont jamais rendus. On stub les imports pour éviter
// d'évaluer leur JSX côté tests.
vi.mock("@/lib/resend/templates/order-confirmed-producer", () => ({
  default: () => null,
  subject: () => "Nouvelle commande",
}));
vi.mock("@/lib/resend/templates/order-revival-blocked", () => ({
  default: () => null,
  subject: () => "Commande remboursée",
}));

// --- Import route AFTER tous les vi.mock ----------------------------------
import { POST } from "@/app/api/stripe/webhook/route";

// --- Mock Supabase (capture des from(table) calls) -----------------------
type Captured = {
  fromCalls: string[];
};

let captured: Captured;

function buildMockSupabase(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      // Builder minimal : la route fait .update().eq() sur payouts
      // uniquement, et on attend qu'il ne soit JAMAIS appelé sur un
      // event rejoué. Si appelé, on retourne thenable no-op pour éviter
      // un crash bruyant qui masque l'assertion réelle.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.update = () => b;
      b.eq = () => b;
      b.then = (onFulfilled: (r: { data: null; error: null }) => unknown) =>
        onFulfilled({ data: null, error: null });
      return b;
    },
  } as unknown as SupabaseClient;
}

function makeRequest(body = '{"id":"evt_test","type":"payment_intent.succeeded"}'): Request {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=123,v1=abc" },
    body,
  });
}

function makeStripeEvent(
  type: string,
  id = "evt_test_1",
  data: Record<string, unknown> = {},
): Stripe.Event {
  return {
    id,
    type,
    data: { object: data },
    api_version: "2024-06-20",
    created: 1700000000,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: null,
  } as unknown as Stripe.Event;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [] };
  mockConstructEvent.mockReset();
  mockCheckOrMarkProcessed.mockReset();
  mockSyncSucceeded.mockReset();
  mockSyncFailed.mockReset();
  mockSyncAccountFlags.mockReset();
  mockCreateAdmin.mockReset();
  mockSendTemplate.mockReset();
  mockSendSms.mockReset();
  mockWaitUntil.mockReset();
  mockCreateAdmin.mockReturnValue(buildMockSupabase());
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// Cas event nouveau (alreadyProcessed=false) — orchestration normale appelée
// =============================================================================

describe("POST /api/stripe/webhook — event nouveau (dédup miss)", () => {
  it("payment_intent.succeeded nouveau → checkOrMarkProcessed + syncStripePaymentSucceeded appelés, response 200 sans deduped", async () => {
    const event = makeStripeEvent("payment_intent.succeeded", "evt_new_succ");
    mockConstructEvent.mockReturnValue(event);
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    // no_metadata = short-circuit immédiat dans le case (cf route.tsx L60-66)
    mockSyncSucceeded.mockResolvedValue({ result: "no_metadata", orderId: null });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(body.deduped).toBeUndefined();

    expect(mockCheckOrMarkProcessed).toHaveBeenCalledTimes(1);
    expect(mockCheckOrMarkProcessed).toHaveBeenCalledWith(
      expect.anything(),
      "evt_new_succ",
      "payment_intent.succeeded",
    );
    expect(mockSyncSucceeded).toHaveBeenCalledTimes(1);
    expect(mockSyncFailed).not.toHaveBeenCalled();
    expect(mockSyncAccountFlags).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Cas event rejoué (alreadyProcessed=true) — short-circuit, handlers NON appelés
// =============================================================================

describe("POST /api/stripe/webhook — event rejoué (dédup hit)", () => {
  it("payment_intent.succeeded rejoué → response 200 deduped:true, syncStripePaymentSucceeded NON appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_replay_1"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, deduped: true });
    expect(mockCheckOrMarkProcessed).toHaveBeenCalledTimes(1);
    expect(mockSyncSucceeded).not.toHaveBeenCalled();
    expect(mockSyncFailed).not.toHaveBeenCalled();
    expect(mockSyncAccountFlags).not.toHaveBeenCalled();
  });

  it("payment_intent.payment_failed rejoué → response 200 deduped:true, syncStripePaymentFailed NON appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.payment_failed", "evt_replay_2"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deduped).toBe(true);
    expect(mockSyncFailed).not.toHaveBeenCalled();
  });

  it("account.updated rejoué → response 200 deduped:true, syncStripeAccountFlags NON appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("account.updated", "evt_replay_3"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deduped).toBe(true);
    expect(mockSyncAccountFlags).not.toHaveBeenCalled();
  });

  it("payout.paid rejoué → response 200 deduped:true, aucun from('payouts') déclenché", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payout.paid", "evt_replay_4", {
        source_transaction: "tr_123",
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deduped).toBe(true);
    // Le case payout.paid fait from('payouts').update().eq(). Si dédup
    // court-circuite correctement, aucun from() ne doit être déclenché.
    expect(captured.fromCalls).toEqual([]);
  });
});

// =============================================================================
// Cas event hors DEDUP_TARGETS — checkOrMarkProcessed NON appelé
// =============================================================================

describe("POST /api/stripe/webhook — event hors targets", () => {
  it("charge.refunded (hors DEDUP_TARGETS) → checkOrMarkProcessed NON appelé, default case → no-op 200", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("charge.refunded", "evt_off_target"),
    );

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(body.deduped).toBeUndefined();
    // KEY assertion : aucun INSERT dans webhook_events_processed pour les
    // events non handled (évite la pollution de la table par tous les
    // events Stripe que Stripe pourrait envoyer en plus des 4 ciblés).
    expect(mockCheckOrMarkProcessed).not.toHaveBeenCalled();
    expect(mockSyncSucceeded).not.toHaveBeenCalled();
    expect(mockSyncFailed).not.toHaveBeenCalled();
    expect(mockSyncAccountFlags).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Cas erreur DB hors 23505 (helper throw) — response 500 → Stripe retry
// =============================================================================

describe("POST /api/stripe/webhook — erreur DB sur dédup", () => {
  it("checkOrMarkProcessed throw (erreur DB hors 23505) → response 500, syncStripePaymentSucceeded NON appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_db_err"),
    );
    mockCheckOrMarkProcessed.mockRejectedValue(
      new Error("webhook_events_processed insert failed: connection lost"),
    );

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("connection lost");
    expect(mockSyncSucceeded).not.toHaveBeenCalled();
  });
});
