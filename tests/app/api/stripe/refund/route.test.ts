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

const { mockRevalidateTag, mockRefundCreate, mockLogPaymentEvent } = vi.hoisted(
  () => ({
    mockRevalidateTag: vi.fn(),
    mockRefundCreate: vi.fn(),
    mockLogPaymentEvent: vi.fn(),
  }),
);

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
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

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
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
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

  it("D3 statut='ready' → 200 happy path (T-151 transition ready→refunded autorisée)", async () => {
    setOrderFetch({ statut: "ready" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).refund_id).toBe("re_test_123");
    // Refund Stripe émis + UPDATE statut=refunded + revalidateTag.
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect((orderUpdate!.payload as Record<string, unknown>).statut).toBe(
      "refunded",
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith("public-stats");
    // badge_annulation_score : aucun UPDATE sur producers (cohérent avec
    // l'absence de logique badge dans cette route — gating dans cancel route).
    expect(captured.updates.find((u) => u.table === "producers")).toBeUndefined();
  });

  it("D4 statut='cancelled' (terminal) → 409, refund Stripe jamais émis", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it("D5 statut='completed' (terminal) → 409, refund Stripe jamais émis (filet clé post-T-151)", async () => {
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
  it("E1 admin pending → refunded : Stripe refund + UPDATE refunded + notification consumer + revalidateTag", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refund_id: "re_test_123" });

    // 1. Stripe refund émis sur le bon PI.
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    // T-408 : 1er arg params metier, 2e arg options idempotency.
    expect(mockRefundCreate).toHaveBeenCalledWith(
      { payment_intent: PI_ID },
      { idempotencyKey: `refund_${ORDER_ID}_admin` },
    );

    // 2. UPDATE orders avec statut+reason+timestamp.
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(orderUpdate).toBeDefined();
    const payload = orderUpdate!.payload as Record<string, unknown>;
    expect(payload.statut).toBe("refunded");
    expect(payload.closure_reason).toBe("admin_refund");
    expect(payload.cancelled_at).toEqual(expect.any(String));
    expect(() =>
      new Date(payload.cancelled_at as string).toISOString(),
    ).not.toThrow();

    // 3. revalidateTag('public-stats') appelé une fois.
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("public-stats");

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

  it("E2 UPDATE error après refund Stripe → 500, refund_id retourné, warning [REFUND_DB_DRIFT] grep-able", async () => {
    responses.orders = {
      select: [{ data: DEFAULT_ORDER, error: null }],
      update: [{ data: null, error: { message: "RLS denied" } }],
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
    // revalidateTag NON appelé puisqu'on retourne 500 avant.
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("E3 revalidateTag throw → 200 conservé, console.warn [STATS_REVAL_WARN]", async () => {
    mockRevalidateTag.mockImplementation(() => {
      throw new Error("cache down");
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[STATS_REVAL_WARN]");
    expect(warned).toContain(ORDER_ID);
    expect(warned).toContain("cache down");
  });

  it("E4 consumer_id null → 200 sans notification.insert", async () => {
    setOrderFetch({ consumer_id: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(
      captured.inserts.find((i) => i.table === "notifications"),
    ).toBeUndefined();
    // Le reste du flow (UPDATE + revalidateTag) reste appelé.
    expect(captured.updates.find((u) => u.table === "orders")).toBeDefined();
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
  });
});

// --- F. T-107 Instrumentation order_admin_refund_failed ------------------

describe("F. T-107 Instrumentation order_admin_refund_failed (audit_logs)", () => {
  it("F1 Stripe refund throw → logPaymentEvent('order_admin_refund_failed') puis exception propagée (pas d'UPDATE ni revalidateTag)", async () => {
    mockRefundCreate.mockReset().mockRejectedValueOnce(new Error("card_declined"));

    await expect(POST(makeRequest())).rejects.toThrow("card_declined");

    expect(mockLogPaymentEvent).toHaveBeenCalledTimes(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "order_admin_refund_failed",
      userId: CONSUMER_ID,
      metadata: {
        order_id: ORDER_ID,
        payment_intent_id: PI_ID,
        refund_error: "card_declined",
      },
    });

    // Exception propagée AVANT UPDATE/notification/revalidateTag.
    expect(captured.updates).toEqual([]);
    expect(
      captured.inserts.find((i) => i.table === "notifications"),
    ).toBeUndefined();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("F2 happy path Stripe OK → logPaymentEvent JAMAIS appelé (pas de pollution audit nominal)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });

  it("F3 consumer_id null + Stripe throw → logPaymentEvent reçoit userId=null (pas de crash)", async () => {
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
        }),
      }),
    );
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
