// Vitest pour POST /api/orders/[id]/cancel.
// Couverture multi-acteur : cron / admin / producer-owner (consumer rejeté
// par le code actuel, cf D1). Couvre zod enum, isTerminal court-circuit,
// Stripe refund avec fallback canTransition, revalidateTag, badge
// anti-annulation, alerte stock 2e rupture, email annulation.
//
// Pattern Supabase aligné sur tests/lib/stripe/handle-payment-failed.test.ts
// et tests/app/(producer)/invitation/_actions/complete-onboarding.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------
// lib/env/urls.ts throw au module-load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_PRODUCER_URL manquent. Le route les charge transitivement
// via le template email order-timeout-cancelled → layout. vi.hoisted est
// hoisté AVANT les imports ES, donc avant la résolution du route.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
});

// --- Hoisted mocks partagés avec les factories vi.mock -------------------
// vi.hoisted permet de partager des vi.fn() entre le module de test et les
// factories vi.mock (sinon les const seraient `undefined` à l'évaluation
// hoistée du factory).
const { mockRevalidateTag, mockRefundCreate, mockSendTemplate } = vi.hoisted(
  () => ({
    mockRevalidateTag: vi.fn(),
    mockRefundCreate: vi.fn(),
    mockSendTemplate: vi.fn(),
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

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
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

let userOwnsProducerResult: boolean;
vi.mock("@/lib/auth/producerOwnership", () => ({
  userOwnsProducer: async () => userOwnsProducerResult,
}));

// --- Supabase admin client mock ------------------------------------------
// Builder chaînable multi-table. Chaque from(table) instancie un builder
// qui capture select/update/insert/eq/gte. La résolution finale (Promise
// via maybeSingle ou thenable) consomme une réponse depuis
// responses[table][op] (FIFO), avec un défaut par (table, op) sinon.
// Sépare les queues par opération pour permettre des SELECT/UPDATE
// indépendants sur la même table sans collision (l'UPDATE n'avale pas la
// réponse SELECT suivante).

type Resp = { data?: unknown; error?: unknown; count?: number };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string; opts?: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  gteCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

const ORDER_ID = "order-1";
const PRODUCER_ID = "prod-1";
const CONSUMER_ID = "cons-1";
const PI_ID = "pi_test_123";

const DEFAULT_ORDER = {
  id: ORDER_ID,
  producer_id: PRODUCER_ID,
  consumer_id: CONSUMER_ID,
  statut: "pending" as string,
  stripe_payment_intent_id: null as string | null,
  montant_total: 12.34,
  code_commande: "ABC123",
  created_at: "2026-04-01T00:00:00Z",
};

function defaultResp(table: string, op: Op): Resp {
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "orders") return { data: DEFAULT_ORDER, error: null };
  if (table === "producers")
    return {
      data: { id: PRODUCER_ID, nom_exploitation: "Ferme Test" },
      error: null,
    };
  if (table === "users")
    return { data: { email: "consumer@example.com" }, error: null };
  if (table === "admin_users")
    return { data: [{ id: "admin-1" }], error: null };
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
      builder.select = (cols: string, opts?: unknown) => {
        captured.selects.push({ table, cols, opts });
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
      builder.gte = (col: string, val: unknown) => {
        captured.gteCalls.push({ table, col, val });
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

import { POST } from "@/app/api/orders/[id]/cancel/route";

// --- Helpers -------------------------------------------------------------

function makeRequest(opts: {
  body?: unknown;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    json: async () => (opts.body === undefined ? {} : opts.body),
    headers: new Headers(opts.headers ?? {}),
  } as unknown as Request;
}

function pushOrderSelects(...resps: Resp[]) {
  responses.orders = responses.orders ?? {};
  responses.orders.select = [...(responses.orders.select ?? []), ...resps];
}

function setOrderFetch(partial: Partial<typeof DEFAULT_ORDER>) {
  responses.orders = responses.orders ?? {};
  const rest = responses.orders.select ?? [];
  responses.orders.select = [
    { data: { ...DEFAULT_ORDER, ...partial }, error: null },
    ...rest,
  ];
}

const PARAMS = { params: { id: ORDER_ID } };

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
    gteCalls: [],
  };
  responses = {};
  // Default : admin valide, flow nominal complet possible.
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  userOwnsProducerResult = true;
  mockRefundCreate.mockReset();
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "res_1" });
  mockRevalidateTag.mockReset();
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  // CRON_SECRET unset par défaut. Tests qui veulent le bypass cron le set
  // explicitement ; afterEach restaure à la valeur d'origine du process.
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

// --- A. Body validation (zod) --------------------------------------------

describe("A. Body validation (zod)", () => {
  it("A1 reason hors enum → 400 Invalid body, sortie avant tout I/O", async () => {
    const res = await POST(
      makeRequest({ body: { reason: "fraude" } }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(captured.fromCalls).toEqual([]);
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("A2 body vide → reason défaut 'other', flow normal continue jusqu'au UPDATE", async () => {
    const res = await POST(makeRequest({ body: {} }), PARAMS);
    expect(res.status).toBe(200);
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(
      (orderUpdate!.payload as Record<string, unknown>).cancellation_reason,
    ).toBe("other");
  });
});

// --- B. Order lookup + idempotence terminal ------------------------------

describe("B. Order lookup + idempotence terminal", () => {
  it("B1 order ID inconnu → 404 Order not found", async () => {
    pushOrderSelects({ data: null, error: null });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
    expect(captured.updates).toEqual([]);
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("B2 order cancelled → 200 already, pas de UPDATE/refund/revalidate/email", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(captured.updates).toEqual([]);
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("B3 order completed → 200 already (idempotent)", async () => {
    setOrderFetch({ statut: "completed" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(captured.updates).toEqual([]);
  });

  it("B4 order refunded → 200 already (idempotent)", async () => {
    setOrderFetch({ statut: "refunded" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(captured.updates).toEqual([]);
  });
});

// --- C. Auth — système (cron) --------------------------------------------

describe("C. Auth — système (cron)", () => {
  it("C1 header x-cron-secret correct → bypass session, flow nominal", async () => {
    process.env.CRON_SECRET = "super-secret";
    sessionUser = null; // si bypass ne marchait pas → 401
    const req = makeRequest({
      body: { reason: "timeout" },
      headers: { "x-cron-secret": "super-secret" },
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.statut).toBe("cancelled");
    // authorizedByProducer = false en chemin cron → pas de badge update.
    expect(
      captured.updates.find((u) => u.table === "producers"),
    ).toBeUndefined();
  });

  it("C2 CRON_SECRET unset, header présent → bypass désactivé → 401", async () => {
    delete process.env.CRON_SECRET;
    sessionUser = null;
    const req = makeRequest({
      headers: { "x-cron-secret": "anything" },
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("C3 ni cron secret ni session → 401", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(captured.updates).toEqual([]);
  });
});

// --- D. Auth — utilisateur -----------------------------------------------

describe("D. Auth — utilisateur", () => {
  it("D1 session consumer (non-admin, non-producer) → 403", async () => {
    // Comportement actuel : le consumer ne peut pas annuler sa propre
    // commande via cet endpoint. Voulu (philosophie anti-abus) ou bug
    // (oubli) ? Investigation produit en TODO. Si décision = autoriser,
    // ce test devra être inversé.
    sessionUser = {
      id: CONSUMER_ID,
      email: "c@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.updates).toEqual([]);
  });

  it("D2 session producer pas owner → 403", async () => {
    sessionUser = {
      id: "user-other",
      email: "other@example.com",
      roles: ["producer"],
      isAdmin: false,
    };
    userOwnsProducerResult = false;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.updates).toEqual([]);
  });

  it("D3 session producer owner → 200 + badge recalculé sur producers", async () => {
    sessionUser = {
      id: "user-prod-owner",
      email: "prod@example.com",
      roles: ["producer"],
      isAdmin: false,
    };
    userOwnsProducerResult = true;
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null },
      {
        data: [
          { id: "o1", statut: "completed" },
          { id: "o2", statut: "cancelled" },
        ],
        error: null,
      },
    );
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    const badgeUpdate = captured.updates.find((u) => u.table === "producers");
    expect(badgeUpdate).toBeDefined();
    expect(
      (badgeUpdate!.payload as Record<string, unknown>).badge_annulation_score,
    ).toBe(50);
  });

  it("D4 session admin → 200, aucun UPDATE producers", async () => {
    // sessionUser admin par défaut
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(
      captured.updates.find((u) => u.table === "producers"),
    ).toBeUndefined();
  });
});

// --- E. Stripe refund + state machine fallback ---------------------------

describe("E. Stripe refund + state machine fallback", () => {
  it("E1 pas de stripe_pi → finalStatus cancelled, stripe.refunds.create jamais appelé", async () => {
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect((await res.json()).statut).toBe("cancelled");
  });

  it("E2 stripe_pi + refund OK + pending → finalStatus refunded, payload UPDATE statut=refunded", async () => {
    setOrderFetch({ stripe_payment_intent_id: PI_ID });
    mockRefundCreate.mockResolvedValue({ id: "re_1" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundCreate).toHaveBeenCalledWith({ payment_intent: PI_ID });
    const json = await res.json();
    expect(json.statut).toBe("refunded");
    expect(json.refund_error).toBeUndefined();
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect((orderUpdate!.payload as Record<string, unknown>).statut).toBe(
      "refunded",
    );
  });

  it("E3 stripe_pi + refund throw → refund_error renvoyé, finalStatus cancelled", async () => {
    setOrderFetch({ stripe_payment_intent_id: PI_ID });
    mockRefundCreate.mockRejectedValue(new Error("stripe down"));
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.statut).toBe("cancelled");
    expect(json.refund_error).toBe("stripe down");
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect((orderUpdate!.payload as Record<string, unknown>).statut).toBe(
      "cancelled",
    );
  });

  it("E4 stripe_pi + refund OK + statut ready → fallback canTransition (ready→refunded illégal) → cancelled (refund Stripe a quand même eu lieu)", async () => {
    setOrderFetch({ statut: "ready", stripe_payment_intent_id: PI_ID });
    mockRefundCreate.mockResolvedValue({ id: "re_1" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    // Le refund Stripe a bien été tenté avant le fallback DB.
    expect(mockRefundCreate).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.statut).toBe("cancelled");
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect((orderUpdate!.payload as Record<string, unknown>).statut).toBe(
      "cancelled",
    );
  });
});

// --- F. UPDATE payload ---------------------------------------------------

describe("F. UPDATE payload", () => {
  it("F1 cas nominal admin pending → cancelled : statut + cancellation_reason + cancelled_at ISO", async () => {
    const res = await POST(
      makeRequest({ body: { reason: "consumer_cancel" } }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(orderUpdate).toBeDefined();
    const payload = orderUpdate!.payload as Record<string, unknown>;
    expect(payload.statut).toBe("cancelled");
    expect(payload.cancellation_reason).toBe("consumer_cancel");
    expect(payload.cancelled_at).toEqual(expect.any(String));
    expect(() =>
      new Date(payload.cancelled_at as string).toISOString(),
    ).not.toThrow();
    // WHERE filter posé sur l'order_id (fetch + update).
    const idEqs = captured.eqCalls.filter(
      (e) => e.table === "orders" && e.col === "id" && e.val === ORDER_ID,
    );
    expect(idEqs.length).toBeGreaterThanOrEqual(2);
  });

  it("F2 reason défaut 'other' remonte dans le payload UPDATE", async () => {
    const res = await POST(makeRequest({ body: {} }), PARAMS);
    expect(res.status).toBe(200);
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(
      (orderUpdate!.payload as Record<string, unknown>).cancellation_reason,
    ).toBe("other");
  });
});

// --- G. revalidateTag ----------------------------------------------------

describe("G. revalidateTag", () => {
  it("G1 revalidateTag('public-stats') appelé une fois en cas nominal", async () => {
    await POST(makeRequest(), PARAMS);
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("public-stats");
  });

  it("G2 revalidateTag throw → console.warn [STATS_REVAL_WARN] mais 200 renvoyé (pas de 500)", async () => {
    mockRevalidateTag.mockImplementation(() => {
      throw new Error("cache down");
    });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[STATS_REVAL_WARN]");
    expect(warned).toContain(ORDER_ID);
    expect(warned).toContain("cache down");
  });
});

// --- H. Badge anti-annulation --------------------------------------------

describe("H. Badge anti-annulation (gating sur authorizedByProducer)", () => {
  it("H1 producer owner → SELECT historique 12 mois (gte created_at) + UPDATE producers.badge_annulation_score (formule)", async () => {
    sessionUser = {
      id: "user-prod-owner",
      email: "prod@example.com",
      roles: ["producer"],
      isAdmin: false,
    };
    userOwnsProducerResult = true;
    // 6 commandes : 3 completed + 2 cancelled + 1 refunded.
    // nonCancelled = 3, total = 6 → score = 3/6*100 = 50.
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null }, // fetch
      {
        data: [
          { id: "o1", statut: "completed" },
          { id: "o2", statut: "completed" },
          { id: "o3", statut: "completed" },
          { id: "o4", statut: "cancelled" },
          { id: "o5", statut: "cancelled" },
          { id: "o6", statut: "refunded" },
        ],
        error: null,
      },
    );
    await POST(makeRequest(), PARAMS);
    const badgeUpdate = captured.updates.find((u) => u.table === "producers");
    expect(badgeUpdate).toBeDefined();
    expect(
      (badgeUpdate!.payload as Record<string, unknown>).badge_annulation_score,
    ).toBe(50);
    // Vérifie le filtre temporel 12 mois (gte sur created_at de la table
    // orders) — garde-fou contre une régression vers une fenêtre absente.
    const historyGte = captured.gteCalls.find(
      (g) => g.table === "orders" && g.col === "created_at",
    );
    expect(historyGte).toBeDefined();
  });

  it("H2 admin → aucun UPDATE producers, aucun SELECT historique", async () => {
    await POST(makeRequest(), PARAMS);
    expect(
      captured.updates.find((u) => u.table === "producers"),
    ).toBeUndefined();
    // Si le badge était calculé, on aurait un gte('created_at') sur orders.
    expect(
      captured.gteCalls.find(
        (g) => g.table === "orders" && g.col === "created_at",
      ),
    ).toBeUndefined();
  });
});

// --- I. Alerte admin 2e rupture stock du mois ----------------------------

describe("I. Alerte admin 2e rupture stock du mois", () => {
  it("I1 reason='stock' + count=1 → pas d'INSERT notifications", async () => {
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null }, // fetch
      { data: null, count: 1, error: null }, // count stock du mois
    );
    await POST(makeRequest({ body: { reason: "stock" } }), PARAMS);
    expect(
      captured.inserts.find((i) => i.table === "notifications"),
    ).toBeUndefined();
  });

  it("I2 reason='stock' + count>=2 → SELECT admin_users + INSERT notifications batch (1 par admin)", async () => {
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null },
      { data: null, count: 5, error: null },
    );
    responses.admin_users = {
      select: [{ data: [{ id: "admin-1" }, { id: "admin-2" }], error: null }],
    };
    await POST(makeRequest({ body: { reason: "stock" } }), PARAMS);
    const notifInsert = captured.inserts.find(
      (i) => i.table === "notifications",
    );
    expect(notifInsert).toBeDefined();
    const payload = notifInsert!.payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0].template).toBe("admin_stock_repeat_offender");
    expect(payload[0].user_id).toBe("admin-1");
    expect(payload[1].user_id).toBe("admin-2");
    const meta = payload[0].metadata as Record<string, unknown>;
    expect(meta.producer_id).toBe(PRODUCER_ID);
    expect(meta.order_id).toBe(ORDER_ID);
    expect(meta.stock_cancellations_this_month).toBe(5);
  });
});

// --- J. Email annulation au consumer -------------------------------------

describe("J. Email annulation au consumer", () => {
  it("J1 consumer.email + producer trouvé → sendTemplate('order_cancelled') avec metadata correcte", async () => {
    await POST(makeRequest({ body: { reason: "producer_cancel" } }), PARAMS);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    const args = mockSendTemplate.mock.calls[0]![0] as {
      template: string;
      to: string;
      userId: string;
      metadata: Record<string, unknown>;
    };
    expect(args.template).toBe("order_cancelled");
    expect(args.to).toBe("consumer@example.com");
    expect(args.userId).toBe(CONSUMER_ID);
    expect(args.metadata.order_id).toBe(ORDER_ID);
    expect(args.metadata.reason).toBe("producer_cancel");
    expect(args.metadata.code_commande).toBe("ABC123");
  });

  it("J2 consumer.email null → sendTemplate jamais appelé, route reste 200", async () => {
    responses.users = {
      select: [{ data: { email: null }, error: null }],
    };
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});
