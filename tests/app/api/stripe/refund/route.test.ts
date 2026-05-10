// Vitest pour POST /api/stripe/refund (refund admin manuel).
// Couverture : zod uuid, auth multi-acteur (cron / admin / producer-owner),
// idempotence refunded, no-PI 409, filet assertTransition strict (409 sans
// refund Stripe sur statut terminal — pas de fallback cancelled comme la
// route cancel), happy path refund + UPDATE + notification + revalidateTag,
// drift Stripe/DB [REFUND_DB_DRIFT], cache flap [STATS_REVAL_WARN].
//
// Pattern aligné sur tests/app/api/orders/[id]/cancel/route.test.ts :
// vi.hoisted pour mocks partagés + builder Supabase chaînable + queues
// séparées par opération sur la même table.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL = "http://localhost:3000";
  // Cluster B Phase 3 : sendOpsAlert -> admin-ops-alert template -> layout
  // -> urls.ts charge aussi NEXT_PUBLIC_ADMIN_URL.
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// Mock helper sendOpsAlert pour ne pas exercer Sentry/Resend dans les tests
// existants.
vi.mock("@/lib/ops/alert", () => ({
  sendOpsAlert: vi.fn(async () => undefined),
}));

const {
  mockRevalidateTag,
  mockRefundCreate,
  mockLogPaymentEvent,
  mockRecordRefundAttempt,
  mockRevalidatePublicStats,
  mockSendTemplate,
  mockConsumeRateLimit,
} = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
  mockRefundCreate: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
  mockRecordRefundAttempt: vi.fn(),
  mockRevalidatePublicStats: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
}));

// Audit Stripe pré-launch W-2 : mock @/lib/rate-limit pour éviter le
// warn lazy-init Upstash en CI. Default beforeEach = success:true.
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mockConsumeRateLimit,
  getStripeRefundRateLimit: () => null,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@/lib/resend/templates/admin-producer-refund-alert", () => ({
  default: () => null,
  subject: (p: { amount: number }) => `subject-${p.amount}`,
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    refunds: { create: mockRefundCreate },
  },
}));

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
}));

// T-102.2.b — mock du helper refund-incidents (réel testé séparément).
vi.mock("@/lib/refund-incidents/record-refund-attempt", () => ({
  recordRefundAttempt: mockRecordRefundAttempt,
}));

// T-100 C2 : mock delegating de revalidatePublicStats. Permet d'asserter la
// signature {source, orderId} passee par la route, tout en preservant
// l'execution reelle du helper (qui appelle revalidateTag mocked) pour les
// tests warn template.
vi.mock("@/lib/stats/revalidate", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/stats/revalidate")>();
  mockRevalidatePublicStats.mockImplementation(actual.revalidatePublicStats);
  return {
    ...actual,
    revalidatePublicStats: mockRevalidatePublicStats,
  };
});

// --- Auth mocks (closure variable) ---------------------------------------
type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// --- Supabase admin client mock ------------------------------------------
// Builder chaînable multi-table avec queues séparées par opération
// (select/update/insert) — l'UPDATE ne consomme pas la réponse SELECT
// suivante. Aligné sur cancel/route.test.ts.

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  rpcCalls: Array<{ name: string; params: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
> & { rpc?: Record<string, Resp[]> };

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCER_ID = "prod-1";
const CONSUMER_ID = "cons-1";
const PRODUCER_USER_ID = "user-prod-owner";
const PI_ID = "pi_test_123";

const DEFAULT_ORDER = {
  id: ORDER_ID,
  consumer_id: CONSUMER_ID as string | null,
  producer_id: PRODUCER_ID,
  statut: "pending" as string,
  stripe_payment_intent_id: PI_ID as string | null,
  montant_total: 12.34,
  code_commande: "ABC123",
};

function defaultResp(table: string, op: Op): Resp {
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "orders") return { data: DEFAULT_ORDER, error: null };
  if (table === "producers")
    return { data: { id: PRODUCER_ID }, error: null };
  return { data: null, error: null };
}

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return defaultResp(table, op);
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        builder._op = "insert";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
    rpc: (name: string, params: unknown) => {
      captured.rpcCalls.push({ name, params });
      const queue = responses.rpc?.[name];
      if (queue && queue.length > 0) return Promise.resolve(queue.shift()!);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/stripe/refund/route";

// --- Helpers -------------------------------------------------------------

function makeRequest(opts: {
  body?: unknown;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    json: async () =>
      opts.body === undefined ? { order_id: ORDER_ID } : opts.body,
    headers: new Headers(opts.headers ?? {}),
  } as unknown as Request;
}

function pushOrderSelect(resp: Resp) {
  responses.orders = responses.orders ?? {};
  responses.orders.select = [...(responses.orders.select ?? []), resp];
}

function pushProducerSelect(resp: Resp) {
  responses.producers = responses.producers ?? {};
  responses.producers.select = [...(responses.producers.select ?? []), resp];
}

function setOrderFetch(partial: Partial<typeof DEFAULT_ORDER>) {
  responses.orders = responses.orders ?? {};
  const rest = responses.orders.select ?? [];
  responses.orders.select = [
    { data: { ...DEFAULT_ORDER, ...partial }, error: null },
    ...rest,
  ];
}

// --- Setup / teardown ----------------------------------------------------

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let savedCronSecret: string | undefined;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
    rpcCalls: [],
  };
  responses = {};
  // Default : admin valide → flow nominal possible.
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockRefundCreate
    .mockReset()
    .mockResolvedValue({ id: "re_test_123" });
  mockRevalidateTag.mockReset();
  // T-100 C2 : reset call tracking sans toucher a l'impl deleguee.
  mockRevalidatePublicStats.mockClear();
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
  mockRecordRefundAttempt.mockReset().mockResolvedValue(null);
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "email_id" });
  mockConsumeRateLimit.mockReset().mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 60_000,
  });
  delete process.env.SUPPORT_REFUND_THRESHOLD_EUR;
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  savedCronSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  if (savedCronSecret !== undefined) {
    process.env.CRON_SECRET = savedCronSecret;
  } else {
    delete process.env.CRON_SECRET;
  }
  vi.restoreAllMocks();
});

// --- A. Body validation (zod uuid) ---------------------------------------

describe("A. Body validation (zod uuid)", () => {
  it("A1 order_id non-UUID → 400 Invalid body, sortie avant tout I/O", async () => {
    const res = await POST(
      makeRequest({ body: { order_id: "not-a-uuid" } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(captured.fromCalls).toEqual([]);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });
});

// --- B. Order lookup -----------------------------------------------------

describe("B. Order lookup", () => {
  it("B1 order ID inconnu → 404 Order not found, pas de refund/UPDATE", async () => {
    pushOrderSelect({ data: null, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});

// --- C. Auth -------------------------------------------------------------

describe("C. Auth multi-acteur", () => {
  it("C1 session admin → 200 happy path", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
  });

  it("C2 session producer owner (producers.id === order.producer_id) → 200", async () => {
    sessionUser = {
      id: PRODUCER_USER_ID,
      email: "prod@example.com",
      roles: ["producer"],
      isAdmin: false,
    };
    pushProducerSelect({ data: { id: PRODUCER_ID }, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Le SELECT producers.user_id= a bien été émis.
    expect(
      captured.eqCalls.find(
        (e) =>
          e.table === "producers" &&
          e.col === "user_id" &&
          e.val === PRODUCER_USER_ID,
      ),
    ).toBeDefined();
  });

  it("C3 session producer non-owner (producers.id mismatch) → 403", async () => {
    sessionUser = {
      id: "user-other",
      email: "other@example.com",
      roles: ["producer"],
      isAdmin: false,
    };
    pushProducerSelect({ data: { id: "prod-other" }, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
  });

  it("C4 ni session ni session producer → 403", async () => {
    sessionUser = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });
});

// --- D. État commande + filet état machine -------------------------------

describe("D. État commande + filet assertTransition", () => {
  it("D1 statut='refunded' → 200 already, refund Stripe pas appelé (idempotent)", async () => {
    setOrderFetch({ statut: "refunded" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("D2 stripe_payment_intent_id null → 409 No payment intent", async () => {
    setOrderFetch({ stripe_payment_intent_id: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No payment intent to refund");
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it("D3 statut='cancelled' (terminal) → 409, refund Stripe jamais émis", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it("D4 statut='completed' (terminal) → 409, refund Stripe jamais émis (filet clé post-T-151)", async () => {
    setOrderFetch({ statut: "completed" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("completed");
    expect(body.error).toContain("refunded");
    // Garde-fou critique : le refund Stripe ne doit PAS être émis quand la
    // transition est refusée — éviter un refund irrécupérable.
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});

// --- E. Happy path + side effects ----------------------------------------

describe("E. Happy path + side effects", () => {
  it("E1 admin pending → refunded : Stripe refund + RPC cancel_order(admin_refund/refunded) + notification + revalidateTag", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refund_id: "re_test_123" });

    // 1. Stripe refund émis sur le bon PI.
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundCreate).toHaveBeenCalledWith(
      { payment_intent: PI_ID },
      { idempotencyKey: `refund_${ORDER_ID}_admin` },
    );

    // 2. F-001 P0-TA : transition via RPC SECDEF cancel_order
    // (reason='admin_refund' ∈ skip-list audit RPC, l'audit Stripe-aware
    // côté caller est posé par logPaymentEvent ci-dessous).
    const rpcCall = captured.rpcCalls.find((r) => r.name === "cancel_order");
    expect(rpcCall).toBeDefined();
    const params = rpcCall!.params as Record<string, unknown>;
    expect(params.p_order_id).toBe(ORDER_ID);
    expect(params.p_reason).toBe("admin_refund");
    expect(params.p_target_status).toBe("refunded");
    expect(captured.updates.find((u) => u.table === "orders")).toBeUndefined();

    // 3. revalidateTag('public-stats') appelé une fois (via helper).
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("public-stats", "max");
    expect(mockRevalidatePublicStats).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePublicStats).toHaveBeenCalledWith({
      source: "stripe-refund",
      orderId: ORDER_ID,
    });

    // 4. Notification consumer insérée avec metadata complète.
    const notif = captured.inserts.find((i) => i.table === "notifications");
    expect(notif).toBeDefined();
    const notifPayload = notif!.payload as Record<string, unknown>;
    expect(notifPayload.user_id).toBe(CONSUMER_ID);
    expect(notifPayload.template).toBe("order_refunded");
    const meta = notifPayload.metadata as Record<string, unknown>;
    expect(meta.order_id).toBe(ORDER_ID);
    expect(meta.refund_id).toBe("re_test_123");
    expect(meta.code_commande).toBe("ABC123");
    expect(meta.amount).toBe(12.34);
  });

  it("E2 RPC error après refund Stripe → 500, refund_id retourné, warning [REFUND_DB_DRIFT] grep-able", async () => {
    responses.rpc = {
      cancel_order: [
        { data: null, error: { code: "40001", message: "RLS denied" } },
      ],
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { refund_id: string; warning: string };
    // Le refund Stripe a été émis : id renvoyé pour réconciliation manuelle.
    expect(body.refund_id).toBe("re_test_123");
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    // Préfixe grep-able + order_id + refund_id + message PostgREST.
    expect(body.warning).toContain("[REFUND_DB_DRIFT]");
    expect(body.warning).toContain(ORDER_ID);
    expect(body.warning).toContain("re_test_123");
    expect(body.warning).toContain("RLS denied");
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(mockRevalidatePublicStats).not.toHaveBeenCalled();
  });

  it("E3 revalidateTag throw → 200 conservé, console.warn [STATS_REVAL_WARN]", async () => {
    mockRevalidateTag.mockImplementation(() => {
      throw new Error("cache down");
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    // T-100 C2 : warn enrichi format `source=<source> orderId=<id> <err>`.
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[STATS_REVAL_WARN]");
    expect(warned).toContain("source=stripe-refund");
    expect(warned).toContain(`orderId=${ORDER_ID}`);
    expect(warned).toContain("cache down");
  });

  it("E4 consumer_id null → 200 sans notification.insert", async () => {
    setOrderFetch({ consumer_id: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(
      captured.inserts.find((i) => i.table === "notifications"),
    ).toBeUndefined();
    // F-001 P0-TA : RPC cancel_order remplace l'UPDATE direct.
    expect(captured.rpcCalls.find((r) => r.name === "cancel_order")).toBeDefined();
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
  });
});

// --- F. T-107 Instrumentation order_admin_refund_failed ------------------

describe("F. T-107 Instrumentation order_admin_refund_failed (audit_logs)", () => {
  it("F1 Stripe refund throw → logPaymentEvent('order_admin_refund_failed') puis exception propagée (pas d'UPDATE ni revalidateTag)", async () => {
    mockRefundCreate.mockReset().mockRejectedValueOnce(new Error("card_declined"));

    await expect(POST(makeRequest())).rejects.toThrow("card_declined");

    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_admin_refund_failed",
        userId: CONSUMER_ID,
        metadata: expect.objectContaining({
          order_id: ORDER_ID,
          payment_intent_id: PI_ID,
          refund_error: "card_declined",
          emitted_by: "admin",
        }),
      }),
    );

    // T-102.2.b — recordRefundAttempt appelée en parallèle (double écriture).
    expect(mockRecordRefundAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordRefundAttempt).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      kind: "admin",
      paymentIntentId: PI_ID,
      consumerId: CONSUMER_ID,
      blockedReason: null,
      outcome: "failed",
      classified: expect.objectContaining({
        category: "unknown",
        message: "card_declined",
      }),
    });

    // Exception propagée AVANT UPDATE/notification/revalidateTag.
    expect(captured.updates).toEqual([]);
    expect(
      captured.inserts.find((i) => i.table === "notifications"),
    ).toBeUndefined();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("F2 happy path admin Stripe OK → logPaymentEvent('order_admin_refund_succeeded'), recordRefundAttempt JAMAIS appelé", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    // Audit Stripe L-5 : event success symétrique au failed historique.
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_admin_refund_succeeded",
        userId: CONSUMER_ID,
        metadata: expect.objectContaining({
          order_id: ORDER_ID,
          emitted_by: "admin",
          refund_id: "re_test_123",
        }),
      }),
    );
    // T-102.2.b — pas d'incident sur succès (helper appelé que dans le catch).
    expect(mockRecordRefundAttempt).not.toHaveBeenCalled();
  });

  it("F3 consumer_id null + Stripe throw → logPaymentEvent + recordRefundAttempt reçoivent userId/consumerId=null (pas de crash)", async () => {
    setOrderFetch({ consumer_id: null });
    mockRefundCreate.mockReset().mockRejectedValueOnce(new Error("network_error"));

    await expect(POST(makeRequest())).rejects.toThrow("network_error");

    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_admin_refund_failed",
        userId: null,
        metadata: expect.objectContaining({
          order_id: ORDER_ID,
          refund_error: "network_error",
          emitted_by: "admin",
        }),
      }),
    );

    // T-102.2.b — consumerId=null propagé au helper (RGPD account deleted).
    expect(mockRecordRefundAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "admin",
        consumerId: null,
        outcome: "failed",
      }),
    );
  });
});

// --- F'. Audit Stripe L-5 — workflow refund producer ---------------------

describe("F'. Audit Stripe L-5 — refund producer audit + email admin", () => {
  function setProducerSession() {
    sessionUser = {
      id: PRODUCER_USER_ID,
      email: "prod@example.com",
      roles: ["producer"],
      isAdmin: false,
    };
    pushProducerSelect({ data: { id: PRODUCER_ID }, error: null });
  }

  it("L-5-A producer + amount < seuil (default 100) → audit log producer mais PAS d'email admin", async () => {
    setProducerSession();
    setOrderFetch({ montant_total: 50 });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_producer_refund_succeeded",
        metadata: expect.objectContaining({
          emitted_by: "producer",
          producer_id: PRODUCER_ID,
          amount: 50,
        }),
      }),
    );
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("L-5-B producer + amount >= seuil → audit log producer + email admin", async () => {
    setProducerSession();
    setOrderFetch({ montant_total: 150 });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_producer_refund_succeeded",
        metadata: expect.objectContaining({ amount: 150 }),
      }),
    );
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@terroir-local.fr",
        template: "admin_producer_refund_alert",
      }),
    );
  });

  it("L-5-C producer + Stripe throw → logPaymentEvent('order_producer_refund_failed')", async () => {
    setProducerSession();
    mockRefundCreate.mockReset().mockRejectedValueOnce(new Error("boom"));
    await expect(POST(makeRequest())).rejects.toThrow("boom");
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "order_producer_refund_failed",
        metadata: expect.objectContaining({
          emitted_by: "producer",
          refund_error: "boom",
        }),
      }),
    );
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("L-5-D SUPPORT_REFUND_THRESHOLD_EUR=200 + amount=150 → pas d'email", async () => {
    process.env.SUPPORT_REFUND_THRESHOLD_EUR = "200";
    setProducerSession();
    setOrderFetch({ montant_total: 150 });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// --- G. T-408 idempotencyKey refund admin --------------------------------

describe("G. T-408 idempotencyKey passe en 2e arg de refunds.create", () => {
  it("T-408 happy path → refunds.create appele avec ({...params}, { idempotencyKey: 'refund_<order.id>_admin' })", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    const [params, options] = mockRefundCreate.mock.calls[0]! as [
      { payment_intent: string },
      { idempotencyKey: string },
    ];
    expect(params.payment_intent).toBe(PI_ID);
    expect(options).toEqual({ idempotencyKey: `refund_${ORDER_ID}_admin` });
  });
});

// --- H. Audit Stripe pré-launch W-2 — rate-limit applicatif --------------
// Cap 5/60s, key user si session, IP fallback sinon. Le rate-limit s'évalue
// AVANT l'admin client + auth check métier (anti-flood le plus tôt possible).

describe("H. W-2 — rate-limit applicatif (5/60s)", () => {
  it("H1 rate-limit non dépassé → flow nominal 200, consumeRateLimit appelé avec session.id (admin)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mockConsumeRateLimit.mock.calls[0]?.[1]).toBe("admin-1");
  });

  it("H2 rate-limit dépassé → 429 + retry_after + Retry-After header, aucun appel Stripe / Supabase métier", async () => {
    const reset = Date.now() + 30_000;
    mockConsumeRateLimit.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset,
    });

    const res = await POST(makeRequest());
    const body = (await res.json()) as { error: string; retry_after: number };

    expect(res.status).toBe(429);
    expect(body.error).toBe("rate_limited");
    expect(body.retry_after).toBeGreaterThan(0);
    expect(body.retry_after).toBeLessThanOrEqual(31);
    expect(res.headers.get("Retry-After")).toBe(String(body.retry_after));

    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(captured.fromCalls).toEqual([]);

    const warnCalls = consoleWarnSpy.mock.calls.map((c: unknown[]) =>
      String(c[0] ?? ""),
    );
    const rlLog = warnCalls.find((m: string) =>
      m.includes("[STRIPE_REFUND_RATE_LIMITED]"),
    );
    expect(rlLog).toBeDefined();
    expect(rlLog!).toContain("key=admin-1");
    expect(rlLog!).toContain("cap=5");
  });

  it("H3 session absente → key = IP fallback (x-forwarded-for)", async () => {
    sessionUser = null;
    mockConsumeRateLimit.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 30_000,
    });

    const res = await POST(
      makeRequest({ headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" } }),
    );
    expect(res.status).toBe(429);
    expect(mockConsumeRateLimit.mock.calls[0]?.[1]).toBe("203.0.113.42");
  });
});
