// Vitest pour POST /api/cart/validate.
//
// Couverture T-444 : auth (401), validation Zod (uuid invalide / items vide
// early-return 200), 4 paths fatal (producer_unavailable / product_unavailable
// / slot_unavailable / slot_full) avec dispatch par table SELECT batch via
// Promise.all, 1 path warning (stock_insufficient + clamp maxQuantite),
// edges (stock=0 → product_unavailable path 5, stock_illimite=true,
// stock_disponible string DB numeric cast), multi-items mixtes + ordre
// d'évaluation (producer testé en 1er, court-circuite), items dupliqués
// (clé itemKey collision = la 2e itération écrase la 1ère, fige
// comportement actuel — reflag T-449 séparé).
//
// Pattern aligné tests/lib/stock-alerts/fetch-producer-alerts.test.ts:45-79
// (.then() thenable + .in() chainable pour chains terminales sans .single()).
//
// 2 clients distincts mockés (createSupabaseServerClient pour producers/
// products/slots, createSupabaseAdminClient pour orders). Queue FIFO
// partagée par table (tables disjointes entre les 2 clients).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Auth mock (closure variable) ----------------------------------------

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

// --- Mock builder partagé entre les 2 clients ----------------------------

type Resp = { data: unknown[] | null; error: { message: string } | null };

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  inCalls: Array<{ table: string; col: string; vals: unknown[] }>;
};

let captured: Captured;
let responses: Record<string, Resp[]>;

function consume(table: string): Resp {
  const queue = responses[table];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: [], error: null };
}

function buildMockClient() {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        return builder;
      };
      builder.in = (col: string, vals: unknown[]) => {
        captured.inCalls.push({ table, col, vals });
        return builder;
      };
      builder.then = (onFulfilled: (resp: Resp) => unknown) =>
        Promise.resolve(onFulfilled(consume(table)));
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => buildMockClient(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => buildMockClient(),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/cart/validate/route";
import { itemKey } from "@/lib/cart/validate";

// --- Constantes UUIDs ----------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCER_ID_OTHER = "22222222-2222-4222-8222-222222222999";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID_2 = "33333333-3333-4333-8333-333333333002";
const PRODUCT_ID_3 = "33333333-3333-4333-8333-333333333003";
const SLOT_ID = "44444444-4444-4444-8444-444444444444";
const DATE_RETRAIT = "2026-05-15";

// --- Helpers -------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return {
    json: async () => body,
  } as unknown as Request;
}

function makeValidItem(
  overrides: Partial<{
    productId: string;
    producerId: string;
    creneauId: string;
    dateRetrait: string;
    quantite: number;
  }> = {},
) {
  return {
    productId: PRODUCT_ID,
    producerId: PRODUCER_ID,
    creneauId: SLOT_ID,
    dateRetrait: DATE_RETRAIT,
    quantite: 2,
    ...overrides,
  };
}

function pushResp(table: string, ...resps: Resp[]) {
  responses[table] = [...(responses[table] ?? []), ...resps];
}

// Helpers pour défaults nominal flow path (B1, G1/G2/G3, H*).
function pushNominalProducer() {
  pushResp("producers", { data: [{ id: PRODUCER_ID }], error: null });
}
function pushProduct(stockDisponible: number | string | null, stockIllimite: boolean, productId = PRODUCT_ID, producerId = PRODUCER_ID) {
  pushResp("products", {
    data: [
      {
        id: productId,
        producer_id: producerId,
        stock_disponible: stockDisponible,
        stock_illimite: stockIllimite,
      },
    ],
    error: null,
  });
}
function pushSlot(capacityPerSlot: number, slotId = SLOT_ID, producerId = PRODUCER_ID) {
  pushResp("slots", {
    data: [{ id: slotId, producer_id: producerId, capacity_per_slot: capacityPerSlot }],
    error: null,
  });
}
function pushOrders(slotIds: string[]) {
  pushResp("orders", {
    data: slotIds.map((slot_id) => ({ slot_id })),
    error: null,
  });
}

// --- Setup / teardown ----------------------------------------------------

beforeEach(() => {
  captured = { fromCalls: [], selects: [], inCalls: [] };
  responses = {};
  sessionUser = {
    id: USER_ID,
    email: "consumer@example.com",
    roles: ["consumer"],
    isAdmin: false,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// A. Auth + Zod validation
// =============================================================================

describe("A. Auth + Zod validation", () => {
  it("A1 — pas de session → 401, aucun I/O", async () => {
    sessionUser = null;
    const res = await POST(makeRequest({ items: [] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(captured.fromCalls).toEqual([]);
  });

  it("A2 — Zod parse fail (productId non-uuid) → 400, aucun I/O", async () => {
    const res = await POST(
      makeRequest({
        items: [{ ...makeValidItem(), productId: "not-a-uuid" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(captured.fromCalls).toEqual([]);
  });

  it("A3 — items vide (Zod accepte sans .min(1)) → 200 + {results:{}} + aucun I/O (early return)", async () => {
    const res = await POST(makeRequest({ items: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: {} });
    expect(captured.fromCalls).toEqual([]);
  });
});

// =============================================================================
// B. Path nominal — 1 item valide
// =============================================================================

describe("B. Path nominal", () => {
  it("B1 — 1 item valide → 200 + {ok: true} + 4 SELECTs batch (producers/products/slots/orders)", async () => {
    pushNominalProducer();
    pushProduct(10, false);
    pushSlot(5);
    pushOrders([]);

    const item = makeValidItem({ quantite: 2 });
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: { [itemKey(item)]: { ok: true } },
    });
    // 4 SELECTs batch (Promise.all en parallèle, ordre source = producers,
    // products, slots, orders).
    expect(captured.fromCalls).toEqual([
      "producers",
      "products",
      "slots",
      "orders",
    ]);
  });
});

// =============================================================================
// C. producer_unavailable
// =============================================================================

describe("C. producer_unavailable", () => {
  it("C1 — producer absent SELECT (RLS-invisible / suspendu / RGPD)", async () => {
    pushResp("producers", { data: [], error: null }); // producer absent
    pushProduct(10, false);
    pushSlot(5);
    pushOrders([]);

    const item = makeValidItem();
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "producer_unavailable" },
      },
    });
  });
});

// =============================================================================
// D. product_unavailable (3 paths : absent / stock=0 / mismatch)
// =============================================================================

describe("D. product_unavailable", () => {
  it("D1 — product absent SELECT (path 2 : retiré / RGPD / active=false)", async () => {
    pushNominalProducer();
    pushResp("products", { data: [], error: null }); // product absent
    pushSlot(5);
    pushOrders([]);

    const item = makeValidItem();
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "product_unavailable" },
      },
    });
  });

  it("D2 — product présent mais stock=0 + !stock_illimite (path 5b stock <= 0 → fatal)", async () => {
    pushNominalProducer();
    pushProduct(0, false); // stock=0, pas illimité
    pushSlot(5);
    pushOrders([]);

    const item = makeValidItem({ quantite: 1 });
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "product_unavailable" },
      },
    });
  });

  it("D3 — product présent mais producer_id mismatch (security/race, l. 129)", async () => {
    pushNominalProducer();
    // Product retrouvé mais appartenant à un AUTRE producer.
    pushProduct(10, false, PRODUCT_ID, PRODUCER_ID_OTHER);
    pushSlot(5);
    pushOrders([]);

    const item = makeValidItem();
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "product_unavailable" },
      },
    });
  });
});

// =============================================================================
// E. slot_unavailable (2 paths : absent / mismatch)
// =============================================================================

describe("E. slot_unavailable", () => {
  it("E1 — slot absent SELECT (supprimé / excluded / active=false — même path)", async () => {
    pushNominalProducer();
    pushProduct(10, false);
    pushResp("slots", { data: [], error: null }); // slot absent
    pushOrders([]);

    const item = makeValidItem();
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "slot_unavailable" },
      },
    });
  });

  it("E2 — slot présent mais producer_id mismatch (security/race, l. 139)", async () => {
    pushNominalProducer();
    pushProduct(10, false);
    pushSlot(5, SLOT_ID, PRODUCER_ID_OTHER); // mismatch
    pushOrders([]);

    const item = makeValidItem();
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "slot_unavailable" },
      },
    });
  });
});

// =============================================================================
// F. slot_full
// =============================================================================

describe("F. slot_full", () => {
  it("F1 — slotCounts(slot_id) >= capacity_per_slot (assertion >= capture atteint+dépassé)", async () => {
    pushNominalProducer();
    pushProduct(10, false);
    pushSlot(2); // capacity=2
    pushOrders([SLOT_ID, SLOT_ID]); // 2 réservations actives → taken=2 = capacity

    const item = makeValidItem();
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: { ok: false, fatal: true, reason: "slot_full" },
      },
    });
  });
});

// =============================================================================
// G. stock_insufficient + edges (stock_illimite, string DB numeric)
// =============================================================================

describe("G. stock_insufficient + edges", () => {
  it("G1 — stock 5 / quantite 10 → stock_insufficient + maxQuantite=5", async () => {
    pushNominalProducer();
    pushProduct(5, false);
    pushSlot(10);
    pushOrders([]);

    const item = makeValidItem({ quantite: 10 });
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: {
          ok: false,
          fatal: false,
          reason: "stock_insufficient",
          maxQuantite: 5,
        },
      },
    });
  });

  it("G2 — stock_illimite=true + quantite=999999 → ok: true (court-circuite check stock)", async () => {
    pushNominalProducer();
    pushProduct(null, true); // stock_disponible null + stock_illimite
    pushSlot(10);
    pushOrders([]);

    const item = makeValidItem({ quantite: 999999 });
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: { [itemKey(item)]: { ok: true } },
    });
  });

  it("G3 — stock_disponible string '5' (DB numeric cast Number()) → stock_insufficient maxQuantite=5", async () => {
    pushNominalProducer();
    pushProduct("5", false); // string DB numeric
    pushSlot(10);
    pushOrders([]);

    const item = makeValidItem({ quantite: 10 });
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: {
          ok: false,
          fatal: false,
          reason: "stock_insufficient",
          maxQuantite: 5,
        },
      },
    });
  });
});

// =============================================================================
// H. Multi-items + ordre d'évaluation
// =============================================================================

describe("H. Multi-items + ordre évaluation", () => {
  it("H1 — 3 items mixtes (valide + product_unavailable + stock_insufficient) → 3 ItemStatus distincts", async () => {
    pushNominalProducer();
    // 3 products dans la response (dédupliqués via Set côté route) :
    // - PRODUCT_ID : ok (stock 10 ≥ quantite 2)
    // - PRODUCT_ID_2 : absent (product_unavailable path 2)
    // - PRODUCT_ID_3 : stock 5 / quantite 10 (stock_insufficient)
    pushResp("products", {
      data: [
        {
          id: PRODUCT_ID,
          producer_id: PRODUCER_ID,
          stock_disponible: 10,
          stock_illimite: false,
        },
        {
          id: PRODUCT_ID_3,
          producer_id: PRODUCER_ID,
          stock_disponible: 5,
          stock_illimite: false,
        },
        // PRODUCT_ID_2 omis volontairement (absent du SELECT result)
      ],
      error: null,
    });
    pushSlot(10);
    pushOrders([]);

    const item1 = makeValidItem({ productId: PRODUCT_ID, quantite: 2 });
    const item2 = makeValidItem({ productId: PRODUCT_ID_2, quantite: 1 });
    const item3 = makeValidItem({ productId: PRODUCT_ID_3, quantite: 10 });

    const res = await POST(makeRequest({ items: [item1, item2, item3] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item1)]: { ok: true },
        [itemKey(item2)]: {
          ok: false,
          fatal: true,
          reason: "product_unavailable",
        },
        [itemKey(item3)]: {
          ok: false,
          fatal: false,
          reason: "stock_insufficient",
          maxQuantite: 5,
        },
      },
    });
  });

  it("H2 — ordre éval : producer testé en 1er (court-circuite product+slot+stock)", async () => {
    // Producer absent → court-circuite TOUTES les autres vérifs (product
    // absent, slot absent, stock 0). Reason = producer_unavailable
    // (l. 119, premier check), pas product/slot/stock_*.
    pushResp("producers", { data: [], error: null });
    pushResp("products", { data: [], error: null });
    pushResp("slots", { data: [], error: null });
    pushOrders([]);

    const item = makeValidItem({ quantite: 1 });
    const res = await POST(makeRequest({ items: [item] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: {
        [itemKey(item)]: {
          ok: false,
          fatal: true,
          reason: "producer_unavailable",
        },
      },
    });
  });

  it("H3 — items dupliqués (même productId/creneauId/dateRetrait) → 2e itération écrase 1ère (fige comportement actuel, reflag T-449)", async () => {
    // Deux items même clé itemKey() (productId+creneauId+dateRetrait
    // identiques) mais quantites différentes. La route traite les 2
    // séquentiellement, results[key] est écrasé → la dernière itération
    // gagne. itemKey() ne discrimine PAS sur quantite ni producerId.
    //
    // Item 1 : quantite=2 → ok: true (stock 10 ≥ 2)
    // Item 2 : quantite=20 → stock_insufficient (stock 10 < 20)
    // Résultat final attendu : results[key] = stock_insufficient
    // (item 2 écrase item 1).
    pushNominalProducer();
    pushProduct(10, false);
    pushSlot(10);
    pushOrders([]);

    const item1 = makeValidItem({ quantite: 2 });
    const item2 = makeValidItem({ quantite: 20 });
    const res = await POST(makeRequest({ items: [item1, item2] }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Record<string, unknown> };
    // Une seule entrée dans results (clé identique), la 2e itération
    // a écrasé la 1ère.
    expect(Object.keys(body.results)).toHaveLength(1);
    expect(body.results[itemKey(item1)]).toEqual({
      ok: false,
      fatal: false,
      reason: "stock_insufficient",
      maxQuantite: 10,
    });
  });
});
