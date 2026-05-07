// Vitest pour POST /api/orders/[id]/confirm.
// Couverture : auth (session), order lookup, autorisation (userOwnsProducer),
// idempotence terminal (already=true), state machine (assertTransition vers
// confirmed depuis pending only), revalidateTag('public-stats'), badge
// confirmation_score (% commandes confirmées ≤ 2h sur 12 mois), email
// order_confirmed_consumer.
//
// Pattern Supabase aligné sur tests/app/api/orders/[id]/cancel/route.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------
// lib/env/urls.ts throw au module-load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_PRODUCER_URL manquent. Le route les charge transitivement
// via le template email order-confirmed-consumer → layout.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// --- Hoisted mocks partagés avec les factories vi.mock -------------------

const { mockRevalidateTag, mockSendTemplate } = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
  mockSendTemplate: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
  googleMapsUrl: (addr: string) =>
    `https://maps.google.com/?q=${encodeURIComponent(addr)}`,
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

const DEFAULT_ORDER = {
  id: ORDER_ID,
  producer_id: PRODUCER_ID,
  consumer_id: CONSUMER_ID,
  statut: "pending" as string,
  code_commande: "ABC123",
  created_at: "2026-04-01T00:00:00Z",
  date_retrait: "2026-05-01",
  heure_retrait: "10:30:00",
  montant_total: 42.5,
};

function defaultResp(table: string, op: Op): Resp {
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "orders") return { data: DEFAULT_ORDER, error: null };
  if (table === "producers")
    return {
      data: {
        id: PRODUCER_ID,
        nom_exploitation: "Ferme Test",
        adresse: "1 rue du Verger",
        code_postal: "75000",
        commune: "Paris",
      },
      error: null,
    };
  if (table === "users")
    return { data: { email: "consumer@example.com" }, error: null };
  if (table === "order_items") return { data: [], error: null };
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
      builder.not = () => builder;
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/orders/[id]/confirm/route";

// --- Helpers -------------------------------------------------------------

function makeRequest(): Request {
  return {
    json: async () => ({}),
    headers: new Headers(),
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
  // Default : session producer owner d'un producer existant.
  sessionUser = {
    id: "user-prod-owner",
    email: "prod@example.com",
    roles: ["producer"],
    isAdmin: false,
  };
  userOwnsProducerResult = true;
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "res_1" });
  mockRevalidateTag.mockReset();
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- A. Auth -------------------------------------------------------------

describe("A. Auth", () => {
  it("A1 pas de session → 401, sortie avant tout I/O Supabase", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(captured.fromCalls).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});

// --- B. Order lookup + idempotence ---------------------------------------

describe("B. Order lookup + idempotence", () => {
  it("B1 order ID inconnu → 404, pas d'UPDATE", async () => {
    pushOrderSelects({ data: null, error: null });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
    expect(captured.updates).toEqual([]);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("B2 order déjà confirmed → 200 already, aucun UPDATE/revalidate/email/badge", async () => {
    setOrderFetch({ statut: "confirmed" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(captured.updates).toEqual([]);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// --- C. Autorisation (userOwnsProducer) ----------------------------------

describe("C. Autorisation (userOwnsProducer)", () => {
  it("C1 session pas owner → 403, pas d'UPDATE", async () => {
    userOwnsProducerResult = false;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.updates).toEqual([]);
  });
});

// --- D. Transition (state machine) ---------------------------------------

describe("D. Transition state machine — confirmed depuis pending only", () => {
  it("D1 statut ready → 409 InvalidOrderTransitionError", async () => {
    setOrderFetch({ statut: "ready" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("ready");
    expect(json.error).toContain("confirmed");
    expect(captured.updates).toEqual([]);
  });

  it("D2 statut cancelled → 409", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    expect(captured.updates).toEqual([]);
  });

  it("D3 statut refunded → 409", async () => {
    setOrderFetch({ statut: "refunded" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    expect(captured.updates).toEqual([]);
  });
});

// --- E. Cas nominal pending → confirmed ----------------------------------

describe("E. Cas nominal pending → confirmed (UPDATE payload)", () => {
  it("E1 pending → 200 + UPDATE orders { statut, confirmed_at } + eq sur id", async () => {
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; confirmed_at: string };
    expect(json.ok).toBe(true);
    expect(json.confirmed_at).toEqual(expect.any(String));
    expect(() => new Date(json.confirmed_at).toISOString()).not.toThrow();

    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(orderUpdate).toBeDefined();
    const payload = orderUpdate!.payload as Record<string, unknown>;
    expect(payload.statut).toBe("confirmed");
    expect(payload.confirmed_at).toEqual(expect.any(String));

    const idEqs = captured.eqCalls.filter(
      (e) => e.table === "orders" && e.col === "id" && e.val === ORDER_ID,
    );
    expect(idEqs.length).toBeGreaterThanOrEqual(2);
  });
});

// --- F. revalidateTag ----------------------------------------------------

describe("F. revalidateTag", () => {
  it("F1 revalidateTag('public-stats') appelé une fois en cas nominal", async () => {
    await POST(makeRequest(), PARAMS);
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("public-stats", "max");
  });

  it("F2 revalidateTag throw → console.warn [STATS_REVAL_WARN] mais 200", async () => {
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

// --- G. Badge confirmation_score -----------------------------------------

describe("G. Badge confirmation_score (gating sur historique)", () => {
  it("G1 historique vide → aucun UPDATE producers", async () => {
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null }, // fetch initial
      { data: [], error: null }, // history
    );
    await POST(makeRequest(), PARAMS);
    expect(
      captured.updates.find((u) => u.table === "producers"),
    ).toBeUndefined();
  });

  it("G2 historique mixte → UPDATE producers.badge_confirmation_score = ratio fast/total × 100", async () => {
    // 4 commandes : 2 confirmées en ≤ 2h, 2 confirmées en > 2h.
    // fast=2, total=4 → score = 2/4*100 = 50 (arrondi 2 décimales).
    const fastDelta = 60 * 60 * 1000; // 1h en ms
    const slowDelta = 3 * 60 * 60 * 1000; // 3h en ms
    const t0 = Date.parse("2026-04-01T00:00:00Z");
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null },
      {
        data: [
          {
            created_at: new Date(t0).toISOString(),
            confirmed_at: new Date(t0 + fastDelta).toISOString(),
          },
          {
            created_at: new Date(t0 + 1000).toISOString(),
            confirmed_at: new Date(t0 + 1000 + fastDelta).toISOString(),
          },
          {
            created_at: new Date(t0 + 2000).toISOString(),
            confirmed_at: new Date(t0 + 2000 + slowDelta).toISOString(),
          },
          {
            created_at: new Date(t0 + 3000).toISOString(),
            confirmed_at: new Date(t0 + 3000 + slowDelta).toISOString(),
          },
        ],
        error: null,
      },
    );
    await POST(makeRequest(), PARAMS);
    const badgeUpdate = captured.updates.find((u) => u.table === "producers");
    expect(badgeUpdate).toBeDefined();
    expect(
      (badgeUpdate!.payload as Record<string, unknown>)
        .badge_confirmation_score,
    ).toBe(50);
  });

  it("G3 filtre temporel 12 mois posé sur created_at (gte cutoff)", async () => {
    pushOrderSelects(
      { data: DEFAULT_ORDER, error: null },
      {
        data: [
          {
            created_at: "2026-04-01T00:00:00Z",
            confirmed_at: "2026-04-01T00:30:00Z",
          },
        ],
        error: null,
      },
    );
    await POST(makeRequest(), PARAMS);
    const historyGte = captured.gteCalls.find(
      (g) => g.table === "orders" && g.col === "created_at",
    );
    expect(historyGte).toBeDefined();
  });
});

// --- H. Email order_confirmed_consumer -----------------------------------

describe("H. Email consumer (order_confirmed_consumer)", () => {
  it("H1 nominal → sendTemplate('order_confirmed_consumer') avec to/userId/metadata", async () => {
    await POST(makeRequest(), PARAMS);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    const args = mockSendTemplate.mock.calls[0]![0] as {
      template: string;
      to: string;
      userId: string;
      metadata: Record<string, unknown>;
    };
    expect(args.template).toBe("order_confirmed_consumer");
    expect(args.to).toBe("consumer@example.com");
    expect(args.userId).toBe(CONSUMER_ID);
    expect(args.metadata.order_id).toBe(ORDER_ID);
    expect(args.metadata.code_commande).toBe("ABC123");
  });

  it("H2 consumer.email null → sendTemplate jamais appelé, route reste 200", async () => {
    responses.users = {
      select: [{ data: { email: null }, error: null }],
    };
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("H3 producer null → sendTemplate jamais appelé, route reste 200", async () => {
    responses.producers = {
      select: [{ data: null, error: null }],
    };
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});
