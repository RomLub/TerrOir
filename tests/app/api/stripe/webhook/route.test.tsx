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
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
  process.env.STRIPE_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test";
  // Bundle 3 : SUPPORT_EMAIL fail-fast au module-load (lib/env/support-email.ts)
  // chargé transitivement par les handlers mockés.
  process.env.SUPPORT_EMAIL =
    process.env.SUPPORT_EMAIL ?? "admin@terroir-local.fr";
});

// --- Hoisted mocks pour les dépendances -----------------------------------
const {
  mockConstructEvent,
  mockCheckOrMarkProcessed,
  mockSyncSucceeded,
  mockSyncFailed,
  mockSyncAccountFlags,
  mockSyncPayoutPaid,
  mockSyncPayoutFailed,
  mockSyncDisputeCreated,
  mockSyncDisputeUpdated,
  mockSyncDisputeClosed,
  mockCreateAdmin,
  mockSendTemplate,
  mockSendSms,
  mockWaitUntil,
  mockLogPaymentEvent,
} = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockCheckOrMarkProcessed: vi.fn(),
  mockSyncSucceeded: vi.fn(),
  mockSyncFailed: vi.fn(),
  mockSyncAccountFlags: vi.fn(),
  mockSyncPayoutPaid: vi.fn(),
  mockSyncPayoutFailed: vi.fn(),
  mockSyncDisputeCreated: vi.fn(),
  mockSyncDisputeUpdated: vi.fn(),
  mockSyncDisputeClosed: vi.fn(),
  mockCreateAdmin: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockSendSms: vi.fn(),
  mockWaitUntil: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
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

vi.mock("@/lib/stripe/handle-payout-failed", () => ({
  syncStripePayoutFailed: mockSyncPayoutFailed,
}));

vi.mock("@/lib/stripe/handle-payout-paid", () => ({
  syncStripePayoutPaid: mockSyncPayoutPaid,
}));

vi.mock("@/lib/stripe/handle-dispute-created", () => ({
  syncStripeDisputeCreated: mockSyncDisputeCreated,
}));

vi.mock("@/lib/stripe/handle-dispute-updated", () => ({
  syncStripeDisputeUpdated: mockSyncDisputeUpdated,
}));

vi.mock("@/lib/stripe/handle-dispute-closed", () => ({
  syncStripeDisputeClosed: mockSyncDisputeClosed,
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

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
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
  payoutsUpdates: unknown[];
};

// Stubs ciblés pour les chaînes payouts/producers utilisées par le case
// payout.paid (T-402 fallback). Le test setter peut overrider via
// configurePayoutPaidFixtures(). Builder thenable + maybeSingle() couvre
// les chaînes UPDATE select et SELECT eq().in().gte().order().limit().
let payoutPaidFixtures: {
  payoutsUpdateData?: unknown[]; // résultat .select('id') après UPDATE source_transaction
  producerByAccount?: { data: unknown; error: unknown } | null;
  payoutByProducer?: { data: unknown; error: unknown } | null;
} = {};

function configurePayoutPaidFixtures(
  fixtures: typeof payoutPaidFixtures,
): void {
  payoutPaidFixtures = fixtures;
}

let captured: Captured;

function buildMockSupabase(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      let isUpdate = false;
      let inCalled = false;

      b.update = (payload: unknown) => {
        isUpdate = true;
        if (table === "payouts") captured.payoutsUpdates.push(payload);
        return b;
      };
      b.select = () => b;
      b.eq = () => b;
      b.in = () => {
        inCalled = true;
        return b;
      };
      b.gte = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.maybeSingle = () => {
        if (table === "producers") {
          return Promise.resolve(
            payoutPaidFixtures.producerByAccount ?? { data: null, error: null },
          );
        }
        if (table === "payouts" && inCalled) {
          return Promise.resolve(
            payoutPaidFixtures.payoutByProducer ?? { data: null, error: null },
          );
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.then = (
        onFulfilled: (r: { data: unknown; error: null }) => unknown,
      ) => {
        if (isUpdate && table === "payouts") {
          // Path source_transaction : .update().eq().select('id')
          return onFulfilled({
            data: payoutPaidFixtures.payoutsUpdateData ?? null,
            error: null,
          });
        }
        return onFulfilled({ data: null, error: null });
      };
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
  account: string | null = null,
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
    account,
  } as unknown as Stripe.Event;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], payoutsUpdates: [] };
  payoutPaidFixtures = {};
  mockConstructEvent.mockReset();
  mockCheckOrMarkProcessed.mockReset();
  mockSyncSucceeded.mockReset();
  mockSyncFailed.mockReset();
  mockSyncAccountFlags.mockReset();
  mockSyncPayoutPaid.mockReset().mockResolvedValue(undefined);
  mockSyncPayoutFailed.mockReset().mockResolvedValue(undefined);
  mockSyncDisputeCreated.mockReset().mockResolvedValue(undefined);
  mockSyncDisputeUpdated.mockReset().mockResolvedValue(undefined);
  mockSyncDisputeClosed.mockReset().mockResolvedValue(undefined);
  mockCreateAdmin.mockReset();
  mockSendTemplate.mockReset();
  mockSendSms.mockReset();
  mockWaitUntil.mockReset();
  mockCreateAdmin.mockReturnValue(buildMockSupabase());
  mockLogPaymentEvent.mockReset();
  mockLogPaymentEvent.mockResolvedValue(undefined);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

  it("payout.paid rejoué → response 200 deduped:true, syncStripePayoutPaid NON appelé", async () => {
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
    // Court-circuit dédup avant le routing case.
    expect(mockSyncPayoutPaid).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Cas event hors DEDUP_TARGETS — checkOrMarkProcessed NON appelé
// =============================================================================

describe("POST /api/stripe/webhook — event hors targets", () => {
  it("customer.created (hors DEDUP_TARGETS) → checkOrMarkProcessed NON appelé, default case → no-op 200", async () => {
    // Choix customer.created : TerrOir crée tous ses customers explicitement
    // côté getOrCreateStripeCustomer, l'event webhook customer.created est
    // donc redondant (cf audit-stripe Annexe A). Phase 2 M-3 ajoute
    // charge.refunded / radar.early_fraud_warning.created /
    // account.application.deauthorized aux DEDUP_TARGETS, donc ce test
    // utilise un event resté volontairement hors switch.
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("customer.created", "evt_off_target"),
    );

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(body.deduped).toBeUndefined();
    // KEY assertion : aucun INSERT dans webhook_events_processed pour les
    // events non handled (évite la pollution de la table par tous les
    // events Stripe que Stripe pourrait envoyer en plus des targets ciblés).
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

// =============================================================================
// Phase 3 multi-events audit (T-081 PR-B) — events Stripe directs
// =============================================================================

describe("POST /api/stripe/webhook — Phase 3 events Stripe (T-081 PR-B)", () => {
  it("account.updated nouveau → syncStripeAccountFlags appelé + logPaymentEvent('stripe_account_updated')", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("account.updated", "evt_acct_1", {
        id: "acct_test_1",
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    mockSyncAccountFlags.mockResolvedValue(undefined);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSyncAccountFlags).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "stripe_account_updated",
      metadata: {
        stripe_account_id: "acct_test_1",
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      },
    });
  });

  it("payout.paid nouveau → délègue à syncStripePayoutPaid avec event.account (extraction T-400)", async () => {
    // T-400 contract test : la route route.tsx case 'payout.paid' délègue
    // toute la logique au helper extrait. La couverture du match
    // source_transaction / fallback / no-match / audit log est dans
    // tests/lib/stripe/handle-payout-paid.test.ts.
    mockConstructEvent.mockReturnValue(
      makeStripeEvent(
        "payout.paid",
        "evt_payout_1",
        {
          id: "po_test_1",
          amount: 12345,
          currency: "eur",
          arrival_date: 1700000000,
          destination: "ba_test_1",
          source_transaction: "tr_test_1",
        },
        "acct_connect_1",
      ),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSyncPayoutPaid).toHaveBeenCalledTimes(1);
    expect(mockSyncPayoutPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "po_test_1",
        source_transaction: "tr_test_1",
      }),
      "acct_connect_1",
      expect.anything(),
    );
  });

  it("charge.dispute.created nouveau → délègue à syncStripeDisputeCreated (extraction T-403 Bundle 3)", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("charge.dispute.created", "evt_dispute_1", {
        id: "dp_test_1",
        charge: "ch_test_1",
        payment_intent: "pi_test_1",
        amount: 5000,
        currency: "eur",
        reason: "fraudulent",
        status: "needs_response",
        evidence_details: { due_by: 1700000000 },
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSyncDisputeCreated).toHaveBeenCalledTimes(1);
    expect(mockSyncDisputeCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dp_test_1" }),
      expect.anything(),
    );
  });

  it("charge.dispute.created rejoué (dédup hit) → response 200 deduped:true, syncStripeDisputeCreated NON appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("charge.dispute.created", "evt_dispute_replay", {
        id: "dp_replay",
        charge: "ch_replay",
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, deduped: true });
    expect(mockSyncDisputeCreated).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Bundle 3 webhook events go-Live (T-401 + T-402 + T-403 extended)
// =============================================================================

describe("POST /api/stripe/webhook — Bundle 3 (T-401 payout.failed)", () => {
  it("payout.failed nouveau → syncStripePayoutFailed appelé avec event.account", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent(
        "payout.failed",
        "evt_payout_failed_1",
        {
          id: "po_test_1",
          amount: 5000,
          currency: "eur",
          failure_code: "account_closed",
          failure_message: "Bank account closed",
        },
        "acct_connect_1",
      ),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSyncPayoutFailed).toHaveBeenCalledTimes(1);
    expect(mockSyncPayoutFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "po_test_1" }),
      "acct_connect_1",
      expect.anything(),
    );
  });
});

// T-400 — Tests T-402 fallback (source_transaction absent + producer match /
// orphan) migrés vers tests/lib/stripe/handle-payout-paid.test.ts. Le contract
// test ci-dessus (mockSyncPayoutPaid called with event.account) garantit la
// délégation route → helper. La logique fallback elle-même est testée en
// isolation côté helper.

describe("POST /api/stripe/webhook — Bundle 3 (T-403 extended dispute.updated + dispute.closed)", () => {
  it("charge.dispute.updated nouveau → syncStripeDisputeUpdated appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("charge.dispute.updated", "evt_dispute_upd_1", {
        id: "dp_upd_1",
        status: "under_review",
        amount: 5000,
        currency: "eur",
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSyncDisputeUpdated).toHaveBeenCalledTimes(1);
    expect(mockSyncDisputeUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dp_upd_1", status: "under_review" }),
      expect.anything(),
    );
  });

  it("charge.dispute.closed nouveau → syncStripeDisputeClosed appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("charge.dispute.closed", "evt_dispute_closed_1", {
        id: "dp_closed_1",
        status: "won",
        amount: 5000,
        currency: "eur",
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockSyncDisputeClosed).toHaveBeenCalledTimes(1);
    expect(mockSyncDisputeClosed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dp_closed_1", status: "won" }),
      expect.anything(),
    );
  });

  it("charge.dispute.updated rejoué (dédup hit) → deduped:true, handler NON appelé", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("charge.dispute.updated", "evt_dispute_upd_replay", {
        id: "dp_replay",
        status: "under_review",
      }),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.deduped).toBe(true);
    expect(mockSyncDisputeUpdated).not.toHaveBeenCalled();
  });
});

// =============================================================================
// F-015 (audit pré-launch 2026-05-10) — IP allowlist soft-warn
// =============================================================================
//
// Rappel : isStripeWebhookIp bypass quand VERCEL_ENV !== 'production'. Les
// tests existants ci-dessus tournent sans VERCEL_ENV (= bypass implicite),
// donc ne sont pas affectés. Cette suite force VERCEL_ENV='production' et
// vérifie que :
//  - IP Stripe valide → handler exécuté normalement, AUCUN log DRIFT
//  - IP non-Stripe → log warn [STRIPE_WEBHOOK_IP_DRIFT] mais handler exécuté
//    (la signature HMAC reste la défense principale)
//  - x-real-ip seul → fallback OK
//  - missing IP header → log warn ip=null mais handler exécuté

describe("POST /api/stripe/webhook — IP allowlist soft-warn (F-015)", () => {
  let originalVercelEnv: string | undefined;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    consoleWarnSpy.mockRestore();
  });

  function makeRequestWithHeaders(headers: Record<string, string>): Request {
    return new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "t=123,v1=abc",
        ...headers,
      },
      body: '{"id":"evt_ip_test","type":"payment_intent.succeeded"}',
    });
  }

  it("IP Stripe officielle (3.18.12.63) → constructEvent + handler exécutés normalement", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_ip_ok"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    mockSyncSucceeded.mockResolvedValue({
      result: "no_metadata",
      orderId: null,
    });

    const res = await POST(
      makeRequestWithHeaders({ "x-forwarded-for": "3.18.12.63" }),
    );

    expect(res.status).toBe(200);
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(mockSyncSucceeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_WEBHOOK_IP_DRIFT]"),
    );
  });

  it("IP non-Stripe (203.0.113.10) → log DRIFT + handler exécuté quand même (F-015)", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_drift_handled"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    mockSyncSucceeded.mockResolvedValue({
      result: "no_metadata",
      orderId: null,
    });

    const res = await POST(
      makeRequestWithHeaders({
        "x-forwarded-for": "203.0.113.10",
        "user-agent": "curl/8.0",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(mockSyncSucceeded).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_WEBHOOK_IP_DRIFT]"),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ip=203.0.113.10"),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ua=curl/8.0"),
    );
  });

  it("x-real-ip Stripe seul (sans x-forwarded-for) → fallback OK, handler exécuté", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_real_ip_ok"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    mockSyncSucceeded.mockResolvedValue({
      result: "no_metadata",
      orderId: null,
    });

    const res = await POST(
      makeRequestWithHeaders({ "x-real-ip": "54.187.216.72" }),
    );

    expect(res.status).toBe(200);
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
  });

  it("aucun header IP en production → log DRIFT ip=null + handler exécuté (F-015)", async () => {
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_drift_null"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    mockSyncSucceeded.mockResolvedValue({
      result: "no_metadata",
      orderId: null,
    });

    const res = await POST(makeRequestWithHeaders({}));

    expect(res.status).toBe(200);
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[STRIPE_WEBHOOK_IP_DRIFT]"),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ip=null"),
    );
  });

  it("VERCEL_ENV=preview + IP non-Stripe → bypass + handler exécuté (parité dev)", async () => {
    process.env.VERCEL_ENV = "preview";
    mockConstructEvent.mockReturnValue(
      makeStripeEvent("payment_intent.succeeded", "evt_preview_bypass"),
    );
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: false });
    mockSyncSucceeded.mockResolvedValue({
      result: "no_metadata",
      orderId: null,
    });

    const res = await POST(
      makeRequestWithHeaders({ "x-forwarded-for": "203.0.113.10" }),
    );

    expect(res.status).toBe(200);
    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
  });
});
